import readline from 'node:readline'
import { randomUUID } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { resolveAnthropicCredentials } from './auth.mjs'
import { resolveWireModel, anthropicBaseUrl } from './modelConfig.mjs'
import { runHooks } from './hookplane.mjs'
import { appendEntry, transcriptToAnthropicMessages, transcriptToOpenAIMessages, makeUserPayload, makeAssistantPayload, makeToolResultPayload } from './transcript.mjs'
import { evaluatePermission } from './permissions.mjs'
import { executeBuiltinTool, anthropicToolDefinitions, openAICompatToolDefinitions, LOCAL_CORE_TOOLS } from './tools.mjs'
import { streamOpenAIChatCompletion } from './openaiCompat.mjs'
import { withTransaction } from './store.mjs'
import { getPhase, setPhase, canTransition } from './workflow.mjs'

// ─── Phase system prompts ─────────────────────────────────────
// The harness owns all phase transitions. The model's only job is to produce
// the artifact for the current phase. It never calls phase-transition tools.

const PHASE_SYSTEM = {
  planning: (cwd, provider, model, date, os, shell, onaInstructions) => `You are ona, an autonomous CLI agent.

You are in PLANNING phase. Your job is two steps:

STEP 1 — EXPLORE (use tools if needed)
Use Read, Glob, or Grep to find relevant existing files and understand the codebase.
Only explore what is actually relevant to the task.
If the task creates something entirely new with no dependencies on existing code, skip straight to Step 2.
Do NOT read files that don't exist yet. Do NOT run commands. Do NOT write code.

STEP 2 — WRITE THE PLAN (final response, no tool calls)
When you have enough information, write your plan using EXACTLY this template:

## Objective
<one sentence describing what you will produce>

## Plan
1. <concrete step>
2. <concrete step>
...

## Proof of Success
<how to verify the result is correct>

# Environment
- Working directory: ${cwd}
- Platform: ${os} | Shell: ${shell} | Date: ${date}
- Provider: ${provider} | Model: ${model}${onaInstructions ? `\n\n# Project Instructions\n${onaInstructions}` : ''}`,

  implement: (cwd, provider, model, date, os, shell, onaInstructions) => `You are ona, an autonomous CLI agent.

You are in IMPLEMENT phase. Execute the approved plan exactly.
- Use Write or Edit to create/modify files
- Use Bash to run commands if needed
- When all implementation work is done, write a one-line summary as your final response: "Done: <what you did>"
- Do not ask questions. Do not explain. Just implement.

# Environment
- Working directory: ${cwd}
- Platform: ${os} | Shell: ${shell} | Date: ${date}
- Provider: ${provider} | Model: ${model}${onaInstructions ? `\n\n# Project Instructions\n${onaInstructions}` : ''}`,

  test: (cwd, provider, model, date, os, shell, onaInstructions) => `You are ona, an autonomous CLI agent.

You are in TEST phase.
- Run the project tests using Bash
- If tests fail, fix the code and re-run
- When all tests pass, write a one-line summary as your final response: "Tests passed: <what was verified>"
- Do not ask questions. Do not explain. Just run the tests.

# Environment
- Working directory: ${cwd}
- Platform: ${os} | Shell: ${shell} | Date: ${date}
- Provider: ${provider} | Model: ${model}${onaInstructions ? `\n\n# Project Instructions\n${onaInstructions}` : ''}`,

  default: (cwd, provider, model, date, os, shell, onaInstructions) => `You are ona, an interactive CLI agent that helps users with software engineering tasks.

- Proactively use tools. Do not ask for permission.
- Be concise. Lead with actions, not reasoning.
- Use Read to understand files before editing.

# Environment
- Working directory: ${cwd}
- Platform: ${os} | Shell: ${shell} | Date: ${date}
- Provider: ${provider} | Model: ${model}${onaInstructions ? `\n\n# Project Instructions\n${onaInstructions}` : ''}`,
}

// ─── Phase user message templates ────────────────────────────
// The user message is the structured prompt the model fills in.
// This is separate from the system prompt so the template appears
// at the point of highest recency in the context.

function buildPlanningUserMessage(userRequest) {
  return `Task: ${userRequest}

Explore the codebase if relevant (use Read/Glob/Grep), then write your plan using EXACTLY this format:

## Objective
<one sentence: what you will produce>

## Plan
1. <step>
2. <step>

## Proof of Success
<how to verify it works>`
}

function buildImplementUserMessage(planContent) {
  return `Approved plan:

${planContent}

Implement the plan now using Write, Edit, and Bash as needed.`
}

function buildTestUserMessage() {
  return `Implementation accepted. You MUST run the tests now using Bash before doing anything else. Execute the appropriate test command for this project (e.g. python hello_world.py, pytest, npm test, etc.).`
}

function buildImplementSummaryPrompt(toolResults) {
  return `You just completed the implementation. Here is what actually happened:

${toolResults}

Fill in this summary using ONLY the information above — do not invent anything:

## Files Changed
- <file path>: <what was done to it>

## Result
<one sentence: what was produced>`
}

function buildTestSummaryPrompt(toolResults) {
  return `You just ran the tests. Here is what actually happened:

${toolResults}

Fill in this summary using ONLY the information above — do not invent anything:

## Tests Run
<command that was executed>

## Result
<one sentence: passed or failed, what was verified>`
}

function buildSystemPrompt(cwd, provider, model, phase, onaInstructions, injectedTools = null) {
  const os = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'
  const shell = process.env.SHELL?.split('/').pop() || 'sh'
  const date = new Date().toISOString().split('T')[0]
  const ticks = String.fromCharCode(96, 96, 96)

  const builder = PHASE_SYSTEM[phase] || PHASE_SYSTEM.default
  let prompt = builder(cwd, provider, model, date, os, shell, onaInstructions)

  if (injectedTools && injectedTools.length > 0) {
    prompt += `\n\n# MANDATORY: Tool Calling Format
Your environment requires JSON tool calls in markdown blocks:
${ticks}json
{"tool": "ToolName", "input": {"param": "value"}}
${ticks}

Available Tools:
${injectedTools.map(t => `- ${t.function.name}: ${t.function.description} (Schema: ${JSON.stringify(t.function.parameters.properties)})`).join('\n')}`
  }

  return prompt
}

// ─── Modification tools blocked in planning phase ─────────────
const MODIFICATION_TOOLS = new Set(['Write', 'Edit', 'Bash', 'NotebookEdit'])

function filterToolsByPhase(tools, phase) {
  if (phase === 'planning') {
    return tools.filter(t => {
      const name = t.name || t.function?.name
      return !MODIFICATION_TOOLS.has(name)
    })
  }
  return tools
}

// ─── Token tracking ───────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────

function makeAnthropicClient(cred) {
  const baseURL = anthropicBaseUrl()
  if (cred.mode === 'bearer') return new Anthropic({ authToken: cred.secret, apiKey: null, baseURL, defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' } })
  if (cred.mode === 'api_key') return new Anthropic({ apiKey: cred.secret, baseURL })
  throw new Error('No credentials for the active model provider')
}

function activeProvider(settings) {
  return settings?.model_config?.provider || 'claude_code_subscription'
}

function toolsForProvider(provider) {
  if (provider === 'lm_studio_local') {
    return {
      anthropic: anthropicToolDefinitions().filter(t => LOCAL_CORE_TOOLS.has(t.name)),
      openai: openAICompatToolDefinitions().filter(t => LOCAL_CORE_TOOLS.has(t.function.name)),
    }
  }
  return { anthropic: anthropicToolDefinitions(), openai: openAICompatToolDefinitions() }
}

async function detectOllamaToolSupport(baseUrl, modelName) {
  try {
    const apiBase = baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '')
    const resp = await fetch(`${apiBase}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(3000)
    })
    if (!resp.ok) return true
    const data = await resp.json()
    return !!(data.template?.includes('.Tools') || data.modelfile?.includes('.Tools'))
  } catch {
    return true
  }
}

function mapAnthropicContent(content) {
  return content.map(b => {
    if (b.type === 'text') return { type: 'text', text: b.text }
    if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input || {} }
    return null
  }).filter(Boolean)
}

function classifyError(e) {
  const msg = String(e?.message || e).toLowerCase()
  if (msg.includes('401')) return 'authentication_failed'
  if (msg.includes('429')) return 'rate_limit'
  if (msg.includes('404')) return 'model_not_found'
  if (msg.includes('500') || msg.includes('503')) return 'server_error'
  return 'unknown'
}

async function askHuman(io, q) {
  if (!process.stdin.isTTY) return true
  if (io?.ask) return (await io.ask(q)).trim().toLowerCase().startsWith('y')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(q, ans => { rl.close(); resolve(/^y(es)?$/i.test(String(ans || '').trim())) })
  })
}

/** Robust regex parsing for manual tool calls in text output */
function parseManualToolCalls(text) {
  const calls = []
  const ticks = String.fromCharCode(96, 96, 96)
  const pattern = ticks + '(?:json)?\\s*(\\{[\\s\\S]*?\\})\\s*' + ticks
  const blockRegex = new RegExp(pattern, 'g')
  let match
  while ((match = blockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim())
      if (parsed.tool) {
        calls.push({ type: 'tool_use', id: `manual-${Math.random().toString(36).slice(2, 9)}`, name: parsed.tool, input: parsed.input || {} })
      }
    } catch { }
  }
  return calls
}

// ─── BOS/EOS token sanitization ──────────────────────────────
// Some models (DeepSeek, Qwen) leak tokenizer control tokens into output text.
function sanitizeModelText(text) {
  if (!text) return text
  return text
    .replace(/<[｜|]begin[▁_]of[▁_]sentence[｜|]>/g, '')
    .replace(/<[｜|]end[▁_]of[▁_]sentence[｜|]>/g, '')
    .replace(/<\|im_start\|>\w*/g, '')
    .replace(/<\|im_end\|>/g, '')
    .trim()
}

// ─── Harness phase gates ──────────────────────────────────────
// Each gate is called by the harness after the model finishes its work.
// The gate shows the artifact to the user, asks for approval, and transitions.
// Returns true if approved and transitioned, false if rejected (stay in phase).

async function planGate(db, rt, io, planText) {
  const clean = sanitizeModelText(planText)
  if (!clean) {
    io.println('\n[planning] Model produced no plan text. Try again.')
    return false
  }
  io.println(`\n${'─'.repeat(60)}\n${clean}\n${'─'.repeat(60)}`)
  const answer = io.ask ? await io.ask('Approve this plan? [y/N] ') : 'y'
  if (!/^y(es)?$/i.test(String(answer || '').trim())) {
    io.println('Plan rejected. Revise your request or try again.')
    setPhase(db, rt.conversationId, 'idle', 'plan_rejected')
    return false
  }
  const hash = randomUUID().slice(0, 16)
  withTransaction(db, () => {
    db.prepare(`INSERT INTO plans(conversation_id, content, hash, status, approved_at) VALUES (?,?,?,'approved',datetime('now'))`).run(rt.conversationId, clean, hash)
  })
  setPhase(db, rt.conversationId, 'implement', 'plan_approved')
  io.println('✓ Plan approved. Entering implementation phase.')
  return true
}

async function implementGate(db, rt, io, summaryText) {
  if (summaryText) io.println(`\n${'─'.repeat(60)}\n${summaryText}\n${'─'.repeat(60)}`)
  const answer = io.ask ? await io.ask('Accept implementation and run tests? [y/N] ') : 'y'
  if (!/^y(es)?$/i.test(String(answer || '').trim())) {
    io.println('Implementation rejected. Continuing in implement phase.')
    return false
  }
  setPhase(db, rt.conversationId, 'test', 'implementation_accepted')
  io.println('✓ Implementation accepted. Entering test phase.')
  return true
}

async function testGate(db, rt, io, summaryText) {
  if (summaryText) io.println(`\n${'─'.repeat(60)}\n${summaryText}\n${'─'.repeat(60)}`)
  const answer = io.ask ? await io.ask('Accept test results and complete task? [y/N] ') : 'y'
  if (!/^y(es)?$/i.test(String(answer || '').trim())) {
    io.println('Test results rejected. Continuing in test phase.')
    return false
  }
  setPhase(db, rt.conversationId, 'idle', 'tests_accepted')
  io.println('✓ Task complete. Returning to idle.')
  return true
}

// ─── Extract recent tool results from transcript ──────────────
// Pulls the tool name + result content for all tool calls in the current session
// since the last user message, to ground the summary in what actually happened.
function extractRecentToolResults(db, sessionId) {
  const rows = db.prepare(`
    SELECT entry_type, payload_json FROM transcript_entries
    WHERE session_id = ? ORDER BY sequence ASC
  `).all(sessionId)

  // Find the last user message index, then collect tool calls + results after it
  let lastUserIdx = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].entry_type === 'user') { lastUserIdx = i; break }
  }

  // If no user message found, scan the whole transcript
  const startIdx = lastUserIdx >= 0 ? lastUserIdx + 1 : 0

  const toolCalls = new Map() // id → name
  const results = []

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i]
    try {
      const payload = JSON.parse(row.payload_json)
      if (row.entry_type === 'assistant') {
        for (const b of payload.content || []) {
          if (b.type === 'tool_use') toolCalls.set(b.id, b.name)
        }
      } else if (row.entry_type === 'tool_result') {
        const name = toolCalls.get(payload.tool_use_id) || 'tool'
        const content = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content)
        const status = payload.is_error ? '✗' : '✓'
        results.push(`${status} ${name}: ${content.slice(0, 300)}`)
      }
    } catch { }
  }

  // If nothing found after last user message, scan the whole transcript for tool results
  // (handles cases where the work turn spans multiple user messages)
  if (!results.length) {
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload_json)
        if (row.entry_type === 'assistant') {
          for (const b of payload.content || []) {
            if (b.type === 'tool_use') toolCalls.set(b.id, b.name)
          }
        } else if (row.entry_type === 'tool_result') {
          const name = toolCalls.get(payload.tool_use_id) || 'tool'
          const content = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content)
          const status = payload.is_error ? '✗' : '✓'
          if (!results.some(r => r.includes(content.slice(0, 50)))) {
            results.push(`${status} ${name}: ${content.slice(0, 300)}`)
          }
        }
      } catch { }
    }
  }

  return results.length ? results.join('\n') : '(no tool results recorded)'
}

// ─── Summary turn ─────────────────────────────────────────────
// After the work loop finishes, inject a summary template and call the model
// once with no tools. Returns the sanitized summary text.

async function runAnthropicSummaryTurn(db, rt, io, hookRt, client, summaryPrompt) {
  appendEntry(db, rt.sessionId, 'user', makeUserPayload(summaryPrompt))
  if (io.spinner) io.spinner.start('Summarising')

  const currentPhase = getPhase(db, rt.conversationId)
  const system = buildSystemPrompt(rt.cwd, activeProvider(rt.settings), rt._model, currentPhase, rt.onaInstructions)
  const messages = transcriptToAnthropicMessages(db, rt.sessionId)

  let bufferedText = ''
  try {
    const stream = await client.messages.stream({ model: rt._model, max_tokens: 1024, system, messages, tools: [] })
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
        bufferedText += ev.delta.text
      }
    }
    const final = await stream.finalMessage()
    trackTokens(rt.sessionId, final.usage?.input_tokens, final.usage?.output_tokens)
    appendEntry(db, rt.sessionId, 'assistant', makeAssistantPayload(mapAnthropicContent(final.content || [])))
  } catch (e) {
    if (io.spinner) io.spinner.stop()
    return null
  }
  if (io.spinner) io.spinner.stop()
  return sanitizeModelText(bufferedText)
}

async function runOpenAICompatSummaryTurn(db, rt, io, hookRt, provider, baseUrl, apiKey, summaryPrompt) {
  appendEntry(db, rt.sessionId, 'user', makeUserPayload(summaryPrompt))
  if (io.spinner) io.spinner.start('Summarising')

  const currentPhase = getPhase(db, rt.conversationId)
  const systemPrompt = buildSystemPrompt(rt.cwd, provider, rt._model, currentPhase, rt.onaInstructions)
  const messages = [{ role: 'system', content: systemPrompt }, ...transcriptToOpenAIMessages(db, rt.sessionId)]

  let result = null
  try {
    const out = await streamOpenAIChatCompletion({ baseUrl, apiKey, model: rt._model, messages, tools: [], io, bufferOutput: true })
    if (out.usage) trackTokens(rt.sessionId, out.usage.prompt_tokens, out.usage.completion_tokens)
    appendEntry(db, rt.sessionId, 'assistant', makeAssistantPayload(out.assistantBlocks))
    result = sanitizeModelText(out.bufferedText)
  } catch {
    // summary is best-effort
  }
  if (io.spinner) io.spinner.stop()
  return result
}

// ─── Model runner (single phase turn) ────────────────────────
// Runs the model in a tool loop until it produces a final text response
// (stop_reason = 'end_turn' with no tool calls). Returns the final text.

async function runAnthropicPhase(db, rt, io, hookRt, client, tools, phase) {
  for (;;) {
    if (io.spinner) io.spinner.start('Thinking')
    const currentPhase = getPhase(db, rt.conversationId)
    const system = buildSystemPrompt(rt.cwd, activeProvider(rt.settings), 'model', currentPhase, rt.onaInstructions)
    const filteredTools = filterToolsByPhase(tools, currentPhase)
    const messages = transcriptToAnthropicMessages(db, rt.sessionId)

    let assistantBlocks = [], stopReason = null, bufferedText = ''
    try {
      const stream = await client.messages.stream({ model: rt._model, max_tokens: 8192, system, messages, tools: filteredTools })
      for await (const ev of stream) {
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          bufferedText += ev.delta.text
        }
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
          if (io.spinner) io.spinner.stop()
          if (io.onToolStart) io.onToolStart(ev.content_block.name)
        }
      }
      const final = await stream.finalMessage()
      stopReason = final.stop_reason
      assistantBlocks = mapAnthropicContent(final.content || [])
      trackTokens(rt.sessionId, final.usage?.input_tokens, final.usage?.output_tokens)
    } catch (e) {
      if (io.spinner) io.spinner.stop()
      await runHooks(db, hookRt, 'StopFailure', { error: classifyError(e), error_details: e.message })
      io.println(`\n[model error] ${e.message}`)
      return null
    }

    if (io.spinner) io.spinner.stop()
    appendEntry(db, rt.sessionId, 'assistant', makeAssistantPayload(assistantBlocks))

    const toolUses = assistantBlocks.filter(b => b.type === 'tool_use')

    // Model is done — return the final text
    if (!toolUses.length || stopReason === 'end_turn') {
      return bufferedText
    }

    // Model called tools — execute them and loop
    await executeToolUses(db, rt, io, hookRt, toolUses)
  }
}

async function runOpenAICompatPhase(db, rt, io, hookRt, provider, baseUrl, apiKey, allTools, injectedTools, phase) {
  let activeTools = injectedTools ? [] : allTools
  let currentInjectedTools = injectedTools

  for (;;) {
    if (io.spinner) io.spinner.start('Thinking')

    const currentPhase = getPhase(db, rt.conversationId)
    const systemPrompt = buildSystemPrompt(rt.cwd, provider, rt._model, currentPhase, rt.onaInstructions, currentInjectedTools)
    const filteredTools = filterToolsByPhase(activeTools, currentPhase)
    const messages = [{ role: 'system', content: systemPrompt }, ...transcriptToOpenAIMessages(db, rt.sessionId)]

    let assistantBlocks, bufferedText = null
    try {
      const out = await streamOpenAIChatCompletion({ baseUrl, apiKey, model: rt._model, messages, tools: filteredTools, io, bufferOutput: true })
      assistantBlocks = out.assistantBlocks
      bufferedText = out.bufferedText

      // Scan text for manual tool calls (models without native tool support)
      const text = assistantBlocks.filter(b => b.type === 'text').map(b => b.text).join('')
      const manualCalls = parseManualToolCalls(text)
      if (manualCalls.length > 0) {
        if (io.spinner) io.spinner.stop()
        for (const call of manualCalls) {
          if (io.onToolStart) io.onToolStart(call.name)
        }
        assistantBlocks = [...assistantBlocks, ...manualCalls]
      }

      if (out.usage) trackTokens(rt.sessionId, out.usage.prompt_tokens, out.usage.completion_tokens)
    } catch (e) {
      if (e.message?.includes('does not support tools') && activeTools.length > 0) {
        if (io.spinner) io.spinner.stop()
        io.println('\n[info] Model switching to manual tool injection...')
        activeTools = []
        currentInjectedTools = allTools
        continue
      }
      if (io.spinner) io.spinner.stop()
      await runHooks(db, hookRt, 'StopFailure', { error: classifyError(e), error_details: e.message })
      io.println(`\n[model error] ${e.message}`)
      return null
    }

    if (io.spinner) io.spinner.stop()

    if (!assistantBlocks.length) return bufferedText

    appendEntry(db, rt.sessionId, 'assistant', makeAssistantPayload(assistantBlocks))
    const toolUses = assistantBlocks.filter(b => b.type === 'tool_use')

    // Strip tool call JSON blocks from displayed text
    let displayText = bufferedText || ''
    if (displayText) {
      const ticks = String.fromCharCode(96, 96, 96)
      const pattern = ticks + '(?:json)?\\s*\\{[\\s\\S]*?\\}\\s*' + ticks
      displayText = displayText.replace(new RegExp(pattern, 'g'), '').trim()
    }

    // Model is done — return the final text
    if (!toolUses.length) {
      return displayText || bufferedText
    }

    // Model called tools — execute them and loop
    await executeToolUses(db, rt, io, hookRt, toolUses)
  }
}

// ─── Main entry point ─────────────────────────────────────────

export async function runUserTurn(db, rt, userText, io) {
  const provider = activeProvider(rt.settings)
  const phase = getPhase(db, rt.conversationId)
  const hookRt = {
    sessionId: rt.sessionId, conversationId: rt.conversationId,
    runtimeDbPath: rt.runtimeDbPath, cwd: rt.cwd,
    permissionMode: rt.settings?.permissions?.defaultMode ?? 'default',
    settings: rt.settings,
  }

  const ups = await runHooks(db, hookRt, 'UserPromptSubmit', { prompt: userText })
  if (!ups.ok) { io.println(`UserPromptSubmit blocked: ${ups.userPrompt?.stderr || 'exit 2'}`); return }

  // ── IDLE: ask user how to proceed ────────────────────────────
  if (phase === 'idle' && io.ask) {
    const answer = await io.ask('Use SDLC workflow (plan → implement → test)? [Y/n] ')
    const useSdlc = !answer.trim() || /^y(es)?$/i.test(answer.trim())
    if (useSdlc) {
      setPhase(db, rt.conversationId, 'planning', 'user_confirmed')
      // Replace the raw user message with the structured planning template
      appendEntry(db, rt.sessionId, 'user', makeUserPayload(buildPlanningUserMessage(userText)))
    } else {
      appendEntry(db, rt.sessionId, 'user', makeUserPayload(userText))
    }
  } else {
    appendEntry(db, rt.sessionId, 'user', makeUserPayload(userText))
  }

  let model
  try { model = resolveWireModel(rt.settings.model_config) } catch (e) { io.println(`[config] ${e.message}`); return }
  rt._model = model

  // ── Run the appropriate phase loop ────────────────────────────
  const currentPhase = getPhase(db, rt.conversationId)

  if (['lm_studio_local', 'openai_compatible', 'zhipu', 'ollama'].includes(provider)) {
    await runSdlcOpenAICompat(db, rt, io, hookRt, provider, model, currentPhase)
  } else {
    await runSdlcAnthropic(db, rt, io, hookRt, model, currentPhase)
  }

  await runHooks(db, hookRt, 'Stop', { stop_hook_active: false })
}

// ─── SDLC harness — Anthropic ─────────────────────────────────

async function runSdlcAnthropic(db, rt, io, hookRt, model, startPhase) {
  const cred = resolveAnthropicCredentials({ bareMode: rt.bareMode, apiKeyHelper: rt.settings?.apiKeyHelper ?? null })
  if (cred.mode === 'none') { io.println('No credentials found.'); return }
  const client = makeAnthropicClient(cred)
  const { anthropic: tools } = toolsForProvider(activeProvider(rt.settings))

  let phase = startPhase

  // Non-SDLC: just run and return
  if (phase === 'idle') {
    const text = await runAnthropicPhase(db, rt, io, hookRt, client, tools, phase)
    if (text) io.write(text)
    return
  }

  // SDLC loop: run phase, gate, transition, repeat
  while (['planning', 'implement', 'test'].includes(phase)) {
    const text = await runAnthropicPhase(db, rt, io, hookRt, client, tools, phase)
    if (text === null) return // model error

    let summary = text
    let advanced = false

    if (phase === 'planning') {
      advanced = await planGate(db, rt, io, summary)
    } else if (phase === 'implement') {
      const toolResults = extractRecentToolResults(db, rt.sessionId)
      summary = await runAnthropicSummaryTurn(db, rt, io, hookRt, client, buildImplementSummaryPrompt(toolResults))
      advanced = await implementGate(db, rt, io, summary)
    } else if (phase === 'test') {
      const toolResults = extractRecentToolResults(db, rt.sessionId)
      summary = await runAnthropicSummaryTurn(db, rt, io, hookRt, client, buildTestSummaryPrompt(toolResults))
      advanced = await testGate(db, rt, io, summary)
    }

    if (!advanced) break // user rejected — stay in current phase, end turn

    phase = getPhase(db, rt.conversationId)
    if (phase === 'idle') break

    // Inject the structured template for the next phase
    const nextMsg = phase === 'implement'
      ? buildImplementUserMessage(db.prepare(`SELECT content FROM plans WHERE conversation_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1`).get(rt.conversationId)?.content || '')
      : buildTestUserMessage()
    appendEntry(db, rt.sessionId, 'user', makeUserPayload(nextMsg))
  }
}

// ─── SDLC harness — OpenAI compat ────────────────────────────

async function runSdlcOpenAICompat(db, rt, io, hookRt, provider, model, startPhase) {
  let baseUrl, apiKey
  const savedBaseUrl = rt.settings?.model_config?.base_url?.replace(/\/+$/, '')
  if (provider === 'ollama') {
    baseUrl = savedBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1'
    apiKey = 'ollama'
  } else {
    baseUrl = savedBaseUrl || process.env.OPENAI_BASE_URL
    apiKey = process.env.OPENAI_API_KEY
  }

  const { openai: allTools } = toolsForProvider(provider)
  const forceManual = rt.settings?.model_config?.force_manual_tools === true
  let nativeSupport = true
  if (provider === 'ollama') nativeSupport = await detectOllamaToolSupport(baseUrl, model)
  const injectedTools = (forceManual || !nativeSupport) ? allTools : null

  let phase = startPhase

  // Non-SDLC: just run and return
  if (phase === 'idle') {
    const text = await runOpenAICompatPhase(db, rt, io, hookRt, provider, baseUrl, apiKey, allTools, injectedTools, phase)
    if (text) io.write(text)
    return
  }

  // SDLC loop: run phase, gate, transition, repeat
  while (['planning', 'implement', 'test'].includes(phase)) {
    const text = await runOpenAICompatPhase(db, rt, io, hookRt, provider, baseUrl, apiKey, allTools, injectedTools, phase)
    if (text === null) return // model error

    let summary = text
    let advanced = false

    if (phase === 'planning') {
      advanced = await planGate(db, rt, io, summary)
    } else if (phase === 'implement') {
      const toolResults = extractRecentToolResults(db, rt.sessionId)
      summary = await runOpenAICompatSummaryTurn(db, rt, io, hookRt, provider, baseUrl, apiKey, buildImplementSummaryPrompt(toolResults))
      advanced = await implementGate(db, rt, io, summary)
    } else if (phase === 'test') {
      const toolResults = extractRecentToolResults(db, rt.sessionId)
      summary = await runOpenAICompatSummaryTurn(db, rt, io, hookRt, provider, baseUrl, apiKey, buildTestSummaryPrompt(toolResults))
      advanced = await testGate(db, rt, io, summary)
    }

    if (!advanced) break

    phase = getPhase(db, rt.conversationId)
    if (phase === 'idle') break

    // Inject the structured template for the next phase
    const nextMsg = phase === 'implement'
      ? buildImplementUserMessage(db.prepare(`SELECT content FROM plans WHERE conversation_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1`).get(rt.conversationId)?.content || '')
      : buildTestUserMessage()
    appendEntry(db, rt.sessionId, 'user', makeUserPayload(nextMsg))
  }
}

// ─── Tool execution ───────────────────────────────────────────

async function executeToolUses(db, rt, io, hookRt, toolUses) {
  for (const tu of toolUses) {
    const toolName = tu.name, toolUseId = tu.id, toolInput = tu.input || {}

    const pre = await runHooks(db, hookRt, 'PreToolUse', { tool_name: toolName, tool_input: toolInput, tool_use_id: toolUseId })
    if (!pre.ok) continue

    const decision = evaluatePermission(rt.settings?.permissions, toolName, toolInput, getPhase(db, rt.conversationId))
    if (decision === 'ask') {
      const ok = await askHuman(io, `Allow ${toolName}? [y/N] `)
      if (!ok) {
        appendEntry(db, rt.sessionId, 'tool_result', makeToolResultPayload(toolUseId, 'User denied permission.', true), toolUseId)
        continue
      }
    } else if (decision === 'deny') {
      appendEntry(db, rt.sessionId, 'tool_result', makeToolResultPayload(toolUseId, 'Permission denied by policy.', true), toolUseId)
      continue
    }

    if (io.onToolStart) io.onToolStart(toolName)
    const execCtx = { sessionId: rt.sessionId, conversationId: rt.conversationId, cwd: rt.cwd, settings: rt.settings }
    const out = await executeBuiltinTool(db, execCtx, toolName, toolInput, io)

    if (toolName === 'Bash' && out.newCwd) rt.cwd = out.newCwd

    withTransaction(db, () => {
      appendEntry(db, rt.sessionId, 'tool_result', makeToolResultPayload(toolUseId, out.content, out.is_error), toolUseId)
    })

    if (io.onToolResult) io.onToolResult(toolName, out.content, out.is_error)

    await runHooks(db, hookRt, out.is_error ? 'PostToolUseFailure' : 'PostToolUse', {
      tool_name: toolName, tool_input: toolInput, tool_use_id: toolUseId,
      ...(out.is_error ? { error: out.content } : { tool_response: { content: out.content, is_error: out.is_error } }),
    })
  }
}
