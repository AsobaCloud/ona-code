import readline from 'node:readline'
import Anthropic from '@anthropic-ai/sdk'
import { resolveAnthropicCredentials } from './auth.mjs'
import { subscriptionStyleHeaders } from './anthropicHeaders.mjs'
import { resolveWireModel, anthropicBaseUrl } from './modelConfig.mjs'
import { runHooks } from './hookplane.mjs'
import { appendEntry, transcriptToAnthropicMessages, transcriptToOpenAIMessages, makeUserPayload, makeAssistantPayload, makeToolResultPayload } from './transcript.mjs'
import { evaluatePermission } from './permissions.mjs'
import { executeBuiltinTool, anthropicToolDefinitions, openAICompatToolDefinitions, LOCAL_CORE_TOOLS } from './tools.mjs'
import { streamOpenAIChatCompletion } from './openaiCompat.mjs'
import { withTransaction } from './store.mjs'
import * as ui from './ui.mjs'

function makeAnthropicClient(cred) {
  const baseURL = anthropicBaseUrl()
  if (cred.mode === 'bearer') return new Anthropic({ authToken: cred.secret, apiKey: null, baseURL, defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' } })
  if (cred.mode === 'api_key') return new Anthropic({ apiKey: cred.secret, baseURL })
  throw new Error('No credentials for the active model provider')
}

function activeProvider(settings) {
  return settings?.model_config?.provider || 'claude_code_subscription'
}

// ── Token tracking ──────────────────────────────────────────
const sessionTokens = new Map()

export function getSessionTokens(sessionId) {
  return sessionTokens.get(sessionId) || { input: 0, output: 0, calls: 0 }
}

function trackTokens(sessionId, inputTokens, outputTokens) {
  const prev = sessionTokens.get(sessionId) || { input: 0, output: 0, calls: 0 }
  sessionTokens.set(sessionId, {
    input: prev.input + (inputTokens || 0),
    output: prev.output + (outputTokens || 0),
    calls: prev.calls + 1,
  })
}

/** Tools to send based on provider — local models get a small subset to avoid context overflow. */
function toolsForProvider(provider) {
  if (provider === 'lm_studio_local') {
    return {
      anthropic: anthropicToolDefinitions().filter(t => LOCAL_CORE_TOOLS.has(t.name)),
      openai: openAICompatToolDefinitions().filter(t => LOCAL_CORE_TOOLS.has(t.function.name)),
    }
  }
  return { anthropic: anthropicToolDefinitions(), openai: openAICompatToolDefinitions() }
}

/** System prompt adapted from Claude Code reference (constants/prompts.ts). */
function buildSystemPrompt(cwd, provider, model, onaInstructions) {
  const os = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'
  const shell = process.env.SHELL?.split('/').pop() || 'sh'
  const date = new Date().toISOString().split('T')[0]

  return `You are ona, an interactive CLI agent that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.

IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.

# System
 - All text you output outside of tool use is displayed to the user. Output text to communicate with the user. You can use Github-flavored markdown for formatting.
 - Tools are executed in a user-selected permission mode. When you attempt to call a tool that is not automatically allowed, the user will be prompted to approve or deny. If the user denies a tool call, adjust your approach.
 - You can call multiple tools in a single response. Make independent tool calls in parallel.

# Doing tasks
 - The user will primarily request software engineering tasks: solving bugs, adding features, refactoring, explaining code, and more.
 - In general, do not propose changes to code you haven't read. Read files first.
 - Do not create files unless absolutely necessary. Prefer editing existing files.
 - Be careful not to introduce security vulnerabilities.
 - Don't add features, refactor, or make improvements beyond what was asked.

# Using your tools
 - Use Read instead of cat/head/tail
 - Use Edit instead of sed/awk
 - Use Write instead of echo/heredoc
 - Use Glob instead of find/ls
 - Use Grep instead of grep/rg
 - Reserve Bash for commands that require shell execution

# Tone and style
 - Be concise. Lead with the answer, not the reasoning.
 - When referencing code, include file_path:line_number.

# Environment
 - Working directory: ${cwd}
 - Platform: ${os}
 - Shell: ${shell}
 - Date: ${date}
 - Provider: ${provider}
 - Model: ${model}${onaInstructions ? `\n\n# Project Instructions (Ona.md)\n${onaInstructions}` : ''}`
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
    if (io.spinner) io.spinner.start('Thinking')
    await runOpenAICompatModelLoop(db, rt, io, hookRt, provider, model, buildSystemPrompt(rt.cwd, provider, model, rt.onaInstructions))
    return
  }

  const cred = resolveAnthropicCredentials({ bareMode: rt.bareMode, apiKeyHelper: rt.settings?.apiKeyHelper ?? null })
  if (cred.mode === 'none') {
    const msg = cred.source === 'none_subscription_preference' ? 'No bearer token found. Set ANTHROPIC_AUTH_TOKEN or use /login.'
      : cred.source === 'none_api_key_preference' ? 'No API key found. Set ANTHROPIC_API_KEY or use /login.'
      : 'No credentials. Set ANTHROPIC_API_KEY or bearer env vars, or run /login'
    io.println(msg)
    await runHooks(db, hookRt, 'Notification', { message: msg, notification_type: 'auth_missing' })
    return
  }

  const client = makeAnthropicClient(cred)
  const { anthropic: tools } = toolsForProvider(provider)
  const system = buildSystemPrompt(rt.cwd, provider, model, rt.onaInstructions)

  for (;;) {
    const messages = transcriptToAnthropicMessages(db, rt.sessionId)
    let assistantBlocks = [], stopReason = null
    try {
      const stream = await client.messages.stream({ model, max_tokens: 8192, system, messages, tools })
      for await (const ev of stream) {
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) io.write(ev.delta.text)
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') io.write(`\n[tool: ${ev.content_block.name}]\n`)
      }
      const final = await stream.finalMessage()
      stopReason = final.stop_reason
      assistantBlocks = mapAnthropicContent(final.content || [])
      trackTokens(rt.sessionId, final.usage?.input_tokens, final.usage?.output_tokens)
    } catch (e) {
      await runHooks(db, hookRt, 'StopFailure', { error: classifyError(e), error_details: e.message })
      io.println(`\n[model error] ${e.message}`)
      return
    }

    appendEntry(db, rt.sessionId, 'assistant', makeAssistantPayload(assistantBlocks))
    const toolUses = assistantBlocks.filter(b => b.type === 'tool_use')
    if (!toolUses.length || stopReason !== 'tool_use') {
      const lastText = assistantBlocks.filter(b => b.type === 'text').map(b => b.text).join('')
      await runHooks(db, hookRt, 'Stop', { stop_hook_active: false, last_assistant_message: lastText })
      break
    }
    await executeToolUses(db, rt, io, hookRt, toolUses)
  }
}

async function runOpenAICompatModelLoop(db, rt, io, hookRt, provider, model, systemPrompt) {
  let baseUrl, apiKey
  if (provider === 'lm_studio_local') {
    baseUrl = process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1'
    apiKey = process.env.LM_STUDIO_API_KEY || 'lm-studio'
  } else {
    baseUrl = process.env.OPENAI_BASE_URL; apiKey = process.env.OPENAI_API_KEY
    if (!nonempty(baseUrl) || !nonempty(apiKey)) { io.println('openai_compatible requires OPENAI_BASE_URL and OPENAI_API_KEY.'); return }
  }
  const { openai: tools } = toolsForProvider(provider)

  for (;;) {
    const rawMessages = transcriptToOpenAIMessages(db, rt.sessionId)
    const messages = [{ role: 'system', content: systemPrompt }, ...rawMessages]
    let assistantBlocks, finishReason
    try {
      const out = await streamOpenAIChatCompletion({ baseUrl, apiKey, model, messages, tools, io })
      assistantBlocks = out.assistantBlocks; finishReason = out.finishReason
      for (const b of assistantBlocks) { if (b.type === 'tool_use') io.write(`\n[tool: ${b.name}]\n`) }
    } catch (e) {
      await runHooks(db, hookRt, 'StopFailure', { error: classifyError(e), error_details: e.message })
      io.println(`\n[model error] ${e.message}`)
      return
    }

    if (!assistantBlocks.length) { io.println(ui.colors.dim('\n  [model returned no content]')); break }
    appendEntry(db, rt.sessionId, 'assistant', makeAssistantPayload(assistantBlocks))
    const toolUses = assistantBlocks.filter(b => b.type === 'tool_use')
    if (!toolUses.length) {
      const textBlocks = assistantBlocks.filter(b => b.type === 'text')
      const fullText = textBlocks.map(b => b.text).join('')
      if (fullText) io.println('\n' + ui.renderMarkdown(fullText))
      await runHooks(db, hookRt, 'Stop', { stop_hook_active: false, last_assistant_message: fullText })
      break
    }
    await executeToolUses(db, rt, io, hookRt, toolUses)
  }
}

async function executeToolUses(db, rt, io, hookRt, toolUses) {
  for (const tu of toolUses) {
    const toolName = tu.name, toolUseId = tu.id, toolInput = tu.input || {}

    if (io.onToolStart) io.onToolStart(toolName)
    else io.println(ui.formatToolStart(toolName))

    const pre = await runHooks(db, hookRt, 'PreToolUse', { tool_name: toolName, tool_input: toolInput, tool_use_id: toolUseId })
    if (!pre.ok || pre.preTool?.denied) {
      const msg = pre.preTool?.message || 'PreToolUse denied'
      appendEntry(db, rt.sessionId, 'tool_result', makeToolResultPayload(toolUseId, msg, true), toolUseId)
      if (io.onToolResult) io.onToolResult(toolName, msg, true)
      else io.println(ui.formatToolResult(toolName, msg, true))
      continue
    }

    const hookAsk = pre.preTool?.hookAsk
    let decision = evaluatePermission(rt.settings?.permissions, toolName, toolInput)
    if (hookAsk) decision = 'ask'

    if (decision === 'deny') {
      appendEntry(db, rt.sessionId, 'tool_result', makeToolResultPayload(toolUseId, 'Permission denied by policy.', true), toolUseId)
      db.prepare(`INSERT INTO tool_permission_log(session_id, tool_use_id, tool_name, decision) VALUES (?,?,?,?)`).run(rt.sessionId, toolUseId, toolName, 'deny')
      await runHooks(db, hookRt, 'PermissionDenied', { tool_name: toolName, tool_input: toolInput, tool_use_id: toolUseId, reason: 'policy' })
      if (io.onToolResult) io.onToolResult(toolName, 'Permission denied by policy.', true)
      else io.println(ui.formatToolResult(toolName, 'Permission denied by policy.', true))
      continue
    }

    if (decision === 'ask') {
      await runHooks(db, hookRt, 'PermissionRequest', { tool_name: toolName, tool_input: toolInput })
      const ok = await askHuman(io, `Allow ${toolName}? [y/N] `)
      db.prepare(`INSERT INTO tool_permission_log(session_id, tool_use_id, tool_name, decision, reason_json) VALUES (?,?,?,?,?)`).run(rt.sessionId, toolUseId, toolName, ok ? 'allow' : 'deny', JSON.stringify({ interactive: true }))
      if (!ok) {
        appendEntry(db, rt.sessionId, 'tool_result', makeToolResultPayload(toolUseId, 'User denied permission.', true), toolUseId)
        await runHooks(db, hookRt, 'PermissionDenied', { tool_name: toolName, tool_input: toolInput, tool_use_id: toolUseId, reason: 'user_denied' })
        continue
      }
    }

    const execCtx = { sessionId: rt.sessionId, conversationId: rt.conversationId, cwd: rt.cwd, settings: rt.settings }
    const out = await executeBuiltinTool(db, execCtx, toolName, toolInput, io)

    withTransaction(db, () => {
      appendEntry(db, rt.sessionId, 'tool_result', makeToolResultPayload(toolUseId, out.content, out.is_error), toolUseId)
    })

    if (io.onToolResult) io.onToolResult(toolName, out.content, out.is_error)
    else io.println(ui.formatToolResult(toolName, out.content, out.is_error))

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

function classifyError(e) {
  const msg = String(e?.message || e).toLowerCase()
  if (msg.includes('401') || msg.includes('authentication')) return 'authentication_failed'
  if (msg.includes('billing') || msg.includes('payment')) return 'billing_error'
  if (msg.includes('429') || msg.includes('rate_limit') || msg.includes('rate limit')) return 'rate_limit'
  if (msg.includes('400') || msg.includes('invalid_request') || msg.includes('invalid request')) return 'invalid_request'
  if (msg.includes('500') || msg.includes('502') || msg.includes('503')) return 'server_error'
  if (msg.includes('max_output') || msg.includes('max_tokens')) return 'max_output_tokens'
  return 'unknown'
}

async function askHuman(io, q) {
  // In pipe mode (non-TTY stdin), allow by default — no human to ask
  if (!process.stdin.isTTY) return true
  if (io?.ask) {
    try {
      const ans = await io.ask(q)
      return /^y(es)?$/i.test(String(ans || '').trim())
    } catch { return true }
  }
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(q, ans => { rl.close(); resolve(/^y(es)?$/i.test(String(ans || '').trim())) })
  })
}
