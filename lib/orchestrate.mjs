import readline from 'node:readline'
import Anthropic from '@anthropic-ai/sdk'
import { resolveAnthropicCredentials } from './auth.mjs'
import { subscriptionStyleHeaders } from './anthropicHeaders.mjs'
import { resolveWireModel, anthropicBaseUrl } from './modelConfig.mjs'
import { runHooks } from './hookplane.mjs'
import { appendEntry, transcriptToAnthropicMessages, transcriptToOpenAIMessages, makeUserPayload, makeAssistantPayload, makeToolResultPayload } from './transcript.mjs'
import { evaluatePermission } from './permissions.mjs'
import { executeBuiltinTool, anthropicToolDefinitions, openAICompatToolDefinitions } from './tools.mjs'
import { streamOpenAIChatCompletion } from './openaiCompat.mjs'
import { withTransaction } from './store.mjs'

function makeAnthropicClient(cred) {
  const baseURL = anthropicBaseUrl()
  if (cred.mode === 'bearer') return new Anthropic({ apiKey: 'oauth-placeholder', baseURL, defaultHeaders: subscriptionStyleHeaders(cred.secret) })
  if (cred.mode === 'api_key') return new Anthropic({ apiKey: cred.secret, baseURL })
  throw new Error('No credentials for the active model provider')
}

function activeProvider(settings) {
  return settings?.model_config?.provider || 'claude_code_subscription'
}

/** §2.5 — one user turn. */
export async function runUserTurn(db, rt, userText, io) {
  const provider = activeProvider(rt.settings)
  const hookRt = {
    sessionId: rt.sessionId, conversationId: rt.conversationId,
    runtimeDbPath: rt.runtimeDbPath, cwd: rt.cwd,
    permissionMode: rt.settings?.permissions?.defaultMode ?? 'default',
    settings: rt.settings,
  }

  const ups = await runHooks(db, hookRt, 'UserPromptSubmit', { prompt: userText })
  if (!ups.ok) { io.println(`UserPromptSubmit blocked: ${ups.userPrompt?.stderr || 'exit 2'}`); return }

  appendEntry(db, rt.sessionId, 'user', makeUserPayload(userText))

  let model
  try { model = resolveWireModel(rt.settings.model_config) } catch (e) { io.println(`[config] ${e.message}`); return }

  if (provider === 'lm_studio_local' || provider === 'openai_compatible') {
    await runOpenAICompatModelLoop(db, rt, io, hookRt, provider, model)
    return
  }

  const cred = resolveAnthropicCredentials({ bareMode: rt.bareMode, apiKeyHelper: rt.settings?.apiKeyHelper ?? null })
  if (cred.mode === 'none') {
    if (cred.source === 'none_subscription_preference') io.println('No bearer token found (ONA_AUTH_PREFERENCE=subscription). Set ANTHROPIC_AUTH_TOKEN or use /login.')
    else if (cred.source === 'none_api_key_preference') io.println('No API key found (ONA_AUTH_PREFERENCE=api_key). Set ANTHROPIC_API_KEY or use /login.')
    else io.println('No credentials. Set ANTHROPIC_API_KEY or bearer env vars, or run /login')
    return
  }

  const client = makeAnthropicClient(cred)
  const tools = anthropicToolDefinitions()

  for (;;) {
    const messages = transcriptToAnthropicMessages(db, rt.sessionId)
    let assistantBlocks = [], stopReason = null
    try {
      const stream = await client.messages.stream({ model, max_tokens: 8192, messages, tools })
      for await (const ev of stream) {
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) io.write(ev.delta.text)
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') io.write(`\n[tool: ${ev.content_block.name}]\n`)
      }
      const final = await stream.finalMessage()
      stopReason = final.stop_reason
      assistantBlocks = mapAnthropicContent(final.content || [])
    } catch (e) { io.println(`\n[model error] ${e.message}`); return }

    appendEntry(db, rt.sessionId, 'assistant', makeAssistantPayload(assistantBlocks))
    const toolUses = assistantBlocks.filter(b => b.type === 'tool_use')
    if (!toolUses.length || stopReason !== 'tool_use') break
    await executeToolUses(db, rt, io, hookRt, toolUses)
  }
}

async function runOpenAICompatModelLoop(db, rt, io, hookRt, provider, model) {
  let baseUrl, apiKey
  if (provider === 'lm_studio_local') {
    baseUrl = rt.settings?.model_config?.lm_studio_base_url || process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1'
    apiKey = process.env.LM_STUDIO_API_KEY || 'lm-studio'
  } else {
    baseUrl = process.env.OPENAI_BASE_URL; apiKey = process.env.OPENAI_API_KEY
    if (!nonempty(baseUrl) || !nonempty(apiKey)) { io.println('openai_compatible requires OPENAI_BASE_URL and OPENAI_API_KEY.'); return }
  }
  const tools = openAICompatToolDefinitions()

  for (;;) {
    const messages = transcriptToOpenAIMessages(db, rt.sessionId)
    let assistantBlocks, finishReason
    try {
      const out = await streamOpenAIChatCompletion({ baseUrl, apiKey, model, messages, tools, io })
      assistantBlocks = out.assistantBlocks; finishReason = out.finishReason
      for (const b of assistantBlocks) { if (b.type === 'tool_use') io.write(`\n[tool: ${b.name}]\n`) }
    } catch (e) { io.println(`\n[model error] ${e.message}`); return }

    if (!assistantBlocks.length) { io.println('\n[model returned no content]'); break }
    appendEntry(db, rt.sessionId, 'assistant', makeAssistantPayload(assistantBlocks))
    const toolUses = assistantBlocks.filter(b => b.type === 'tool_use')
    if (!toolUses.length) break
    await executeToolUses(db, rt, io, hookRt, toolUses)
  }
}

async function executeToolUses(db, rt, io, hookRt, toolUses) {
  for (const tu of toolUses) {
    const toolName = tu.name, toolUseId = tu.id, toolInput = tu.input || {}

    const pre = await runHooks(db, hookRt, 'PreToolUse', { tool_name: toolName, tool_input: toolInput, tool_use_id: toolUseId })
    if (!pre.ok || pre.preTool?.denied) {
      appendEntry(db, rt.sessionId, 'tool_result', makeToolResultPayload(toolUseId, pre.preTool?.message || 'PreToolUse denied', true), toolUseId)
      continue
    }

    const hookAsk = pre.preTool?.hookAsk
    let decision = evaluatePermission(rt.settings?.permissions, toolName, toolInput)
    if (hookAsk) decision = 'ask'

    if (decision === 'deny') {
      appendEntry(db, rt.sessionId, 'tool_result', makeToolResultPayload(toolUseId, 'Permission denied by policy.', true), toolUseId)
      db.prepare(`INSERT INTO tool_permission_log(session_id, tool_use_id, tool_name, decision) VALUES (?,?,?,?)`).run(rt.sessionId, toolUseId, toolName, 'deny')
      continue
    }

    if (decision === 'ask') {
      const ok = await askHuman(io, `Allow ${toolName}? [y/N] `)
      db.prepare(`INSERT INTO tool_permission_log(session_id, tool_use_id, tool_name, decision, reason_json) VALUES (?,?,?,?,?)`).run(rt.sessionId, toolUseId, toolName, ok ? 'allow' : 'deny', JSON.stringify({ interactive: true }))
      if (!ok) {
        appendEntry(db, rt.sessionId, 'tool_result', makeToolResultPayload(toolUseId, 'User denied permission.', true), toolUseId)
        continue
      }
    }

    const execCtx = { sessionId: rt.sessionId, conversationId: rt.conversationId, cwd: rt.cwd, settings: rt.settings }
    const out = await executeBuiltinTool(db, execCtx, toolName, toolInput, io)

    withTransaction(db, () => {
      appendEntry(db, rt.sessionId, 'tool_result', makeToolResultPayload(toolUseId, out.content, out.is_error), toolUseId)
    })

    await runHooks(db, hookRt, out.is_error ? 'PostToolUseFailure' : 'PostToolUse', {
      tool_name: toolName, tool_input: toolInput, tool_use_id: toolUseId,
      ...(out.is_error ? { error: out.content } : { tool_response: { content: out.content, is_error: out.is_error } }),
    })
  }
}

function mapAnthropicContent(content) {
  return content.map(b => {
    if (b.type === 'text') return { type: 'text', text: b.text }
    if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input || {} }
    return null
  }).filter(Boolean)
}

function nonempty(s) { return typeof s === 'string' && s.trim().length > 0 }

async function askHuman(io, q) {
  if (io?.ask) {
    const ans = await io.ask(q)
    return /^y(es)?$/i.test(String(ans || '').trim())
  }
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(q, ans => { rl.close(); resolve(/^y(es)?$/i.test(String(ans || '').trim())) })
  })
}
