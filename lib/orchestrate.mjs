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

const PHASE_SYSTEM = {
  explore: (cwd, provider, model, date, os, shell, onaInstructions) => `You are ona, an autonomous CLI agent.

You are in EXPLORE phase. Your ONLY job is to find and read files relevant to the task.
- Use Glob, Grep, and Read to explore the codebase
- Read every file that could be relevant to the task
- Do NOT write plans, suggest steps, ask questions, or produce any output other than tool calls
- When you have read everything relevant, output EXACTLY this single line and nothing else:
  Exploration complete.

# Environment
- Working directory: ${cwd}
- Platform: ${os} | Shell: ${shell} | Date: ${date}
- Provider: ${provider} | Model: ${model}${onaInstructions ? `\n\n# Project Instructions\n${onaInstructions}` : ''}`,

  planning: (cwd, provider, model, date, os, shell, onaInstructions) => `You are ona, an autonomous CLI agent.

You are in PLANNING phase. The exploration above has already been completed — all relevant files have been read and are visible in the conversation above.
Write your plan based ONLY on what was found during exploration. Do NOT use any more tools.

Write your plan using EXACTLY this template and nothing else:

## Objective
<one sentence describing what you will produce>

## Plan
1. <exact command, script invocation, or file write — not vague intent>
2. <exact command, script invocation, or file write>
...

Rules: every step must name exact paths and commands extracted from the files you read. Never use "review", "reference", or "based on documentation" as a step.

## Proof of Success
<specific file or output that will exist when done>

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

function buildExploreUserMessage(userRequest) {
  return `Task: ${userRequest}

Explore systematically to find files relevant to this specific task:

1. Glob pattern "**/*.md" to find documentation files — read any whose names relate to the task
2. Glob pattern "**/*.py" to find Python scripts — read any that look relevant to the task
3. Glob pattern "**/*.sh" to find shell scripts — read any that look relevant to the task
4. Use Grep to search for keywords from the task if globs don't surface the right files
5. Read only files that appeared in glob/grep results and are plausibly relevant to this specific task

IMPORTANT: Your task is "${userRequest}". Only read files related to this task.

Use the working directory as the base for all globs.
Do NOT guess paths. Only read files that appear in glob results.
When done reading, output EXACTLY:
  Exploration complete.`
}

function buildPlanningUserMessage(filesRead, userRequest) {
  let fileSection
  if (!filesRead || filesRead.length === 0) {
    fileSection = '(no files recorded — base plan on what is visible in the conversation above)'
  } else {
    fileSection = filesRead.map(({ path, content }) =>
      `### ${path}\n\`\`\`\n${content}\n\`\`\``
    ).join('\n\n')
  }

  return `Exploration is complete. Here are the files you read:

${fileSection}

${userRequest ? `Original task: ${userRequest}\n\n` : ''}Write your plan using ONLY the content above. Do NOT reference files you did not read.

Write your plan using EXACTLY this format:

## Objective
<one sentence: what you will produce>

## Relevant files
<list only files shown above>

## Plan
1. <concrete step — must specify exact file path, command, or code change, NOT vague intent like "review" or "reference">
2. <concrete step>

RULES FOR PLAN STEPS:
- Every step must be executable: name the exact script, command, or file to write
- If running a script, include the exact invocation with arguments drawn from the file content above
- If writing a file, name the target path and describe its contents
- NEVER use vague verbs: "review", "understand", "reference", "use as reference", "based on the documentation"

## Proof of Success
<specific file or output that will exist when done>

Do NOT use any tools. Write the plan only.`
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

// ─── Tool filters by phase ────────────────────────────────────
const MODIFICATION_TOOLS = new Set(['Write', 'Edit', 'Bash', 'NotebookEdit'])
const EXPLORE_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep'])

function filterToolsByPhase(tools, phase) {
  if (phase === 'explore') {
    // Explore: read-only tools only
    return tools.filter(t => {
      const name = t.name || t.function?.name
      return EXPLORE_ONLY_TOOLS.has(name)
    })
  }
  if (phase === 'planning') {
    // Planning: no tools — model writes plan from memory of what it explored
    return []
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

// ─── Adaptive tool selection ──────────────────────────────────

function toolsForProvider(provider, nativeToolSupport = true) {
  const coreOnly = provider === 'lm_studio_local' || (provider === 'ollama' && !nativeToolSupport)
  return {
    anthropic: coreOnly
      ? anthropicToolDefinitions().filter(t => LOCAL_CORE_TOOLS.has(t.name))
      : anthropicToolDefinitions(),
    openai: coreOnly
      ? openAICompatToolDefinitions().filter(t => LOCAL_CORE_TOOLS.has(t.function.name))
      : openAICompatToolDefinitions(),
  }
}

// ─── Ollama capability detection ──────────────────────────────

const ollamaCapabilityCache = new Map()

async function detectOllamaToolSupport(baseUrl, modelName) {
  const key = `${baseUrl}::${modelName}`
  if (ollamaCapabilityCache.has(key)) return ollamaCapabilityCache.get(key)

  let result = true
  try {
    const apiBase = baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '')
    const resp = await fetch(`${apiBase}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(3000)
    })
    if (!resp.ok) { result = true }
    else {
      const data = await resp.json()
      result = !!(
        data.template?.includes('.Tools') ||
        data.modelfile?.includes('.Tools') ||
        data.capabilities?.includes('tools')
      )
    }
  } catch {
    result = true
  }

  ollamaCapabilityCache.set(key, result)
  return result
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

function sanitizeModelText(text) {
  if (!text) return text
  return text
    .replace(/<[｜|]begin[▁_]of[▁_]sentence[｜|]>/g, '')
    .replace(/<[｜|]end[▁_]of[▁_]sentence[｜|]>/g, '')
    .replace(/<\|im_start\|>\w*/g, '')
    .replace(/<\|im_end\|>/g, '')
    .trim()
}

function sanitizeMessages(messages) {
  return messages.map(m => {
    if (typeof m.content === 'string') {
      return { ...m, content: sanitizeModelText(m.content) }
    }
    if (Array.isArray(m.content)) {
      return {
        ...m,
        content: m.content.map(block => {
          if (typeof block === 'string') return sanitizeModelText(block)
          if (block?.text) return { ...block, text: sanitizeModelText(block.text) }
          if (block?.content && typeof block.content === 'string') return { ...block, content: sanitizeModelText(block.content) }
          return block
        }),
      }
    }
    return m
  })
}

// ─── Extract files read during exploration (with content) ─────
// Reads the transcript and returns { path, content } for every file
// successfully Read during explore. Content is capped per file so
// the planning message stays within a 14B model's useful context range.

const CONTENT_CAP_CHARS = 3000

function extractFilesRead(db, sessionId) {
  const rows = db.prepare(`
    SELECT entry_type, payload_json FROM transcript_entries
    WHERE session_id = ? ORDER BY sequence ASC
  `).all(sessionId)

  // Pass 1: map tool_use id → { name, path } for Read calls
  const toolCalls = new Map()
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json)
      if (row.entry_type === 'assistant') {
        for (const b of payload.content || []) {
          if (b.type === 'tool_use' && b.name === 'Read') {
            toolCalls.set(b.id, b.input?.path || b.input?.file_path || '(unknown)')
          }
        }
      }
    } catch { }
  }

  // Pass 2: collect successful results and their content
  const seen = new Set()
  const files = []

  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json)
      if (row.entry_type === 'tool_result') {
        const filePath = toolCalls.get(payload.tool_use_id)
        if (!filePath || payload.is_error || seen.has(filePath)) continue
        seen.add(filePath)

        const raw = typeof payload.content === 'string'
          ? payload.content
          : (payload.content?.[0]?.text ?? '')

        const content = raw.length > CONTENT_CAP_CHARS
          ? raw.slice(0, CONTENT_CAP_CHARS) + `\n... [truncated — ${raw.length} chars total]`
          : raw

        files.push({ path: filePath, content })
      }
    } catch { }
  }

  return files
}

// ─── Harness phase gates ──────────────────────────────────────

async function exploreGate(db, rt, io, userRequest) {
  const filesRead = extractFilesRead(db, rt.sessionId)
  appendEntry(db, rt.sessionId, 'user', makeUserPayload(
    buildPlanningUserMessage(filesRead, userRequest)
  ))
  setPhase(db, rt.conversationId, 'planning', 'explore_complete')
  io.println('✓ Exploration complete. Entering planning phase.')
  return true
}

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

function extractRecentToolResults(db, sessionId) {
  const rows = db.prepare(`
    SELECT entry_type, payload_json FROM transcript_entries
    WHERE session_id = ? ORDER BY sequence ASC
  `).all(sessionId)

  let lastUserIdx = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].entry_type === 'user') { lastUserIdx = i; break }
  }

  const startIdx = lastUserIdx >= 0 ? lastUserIdx + 1 : 0
  const toolCalls = new Map()
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
  const rawMessages = transcriptToOpenAIMessages(db, rt.sessionId)
  const messages = [{ role: 'system', content: systemPrompt }, ...sanitizeMessages(rawMessages)]

  let result = null
  try {
    const out = await streamOpenAIChatCompletion({ baseUrl, apiKey, model: rt._model, messages, tools: [], io, bufferOutput: true, numCtx: rt.settings?.model_config?.num_ctx })
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

async function runAnthropicPhase(db, rt, io, hookRt, client, tools, phase) {
  for (;;) {
    if (io.spinner) io.spinner.start('Thinking')
    const currentPhase = getPhase(db, rt.conversationId)
    const system = buildSystemPrompt(rt.cwd, activeProvider(rt.settings), rt._model, currentPhase, rt.onaInstructions)
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

    if (!toolUses.length || stopReason === 'end_turn') {
      return bufferedText
    }

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
    const rawMessages = transcriptToOpenAIMessages(db, rt.sessionId)
    const messages = [{ role: 'system', content: systemPrompt }, ...sanitizeMessages(rawMessages)]

    let assistantBlocks, bufferedText = null, finishReason = null
    try {
      const out = await streamOpenAIChatCompletion({ baseUrl, apiKey, model: rt._model, messages, tools: filteredTools, io, bufferOutput: true, numCtx: rt.settings?.model_config?.num_ctx })
      assistantBlocks = out.assistantBlocks
      bufferedText = out.bufferedText
      finishReason = out.finishReason

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
        const cacheKey = `${baseUrl}::${rt._model}`
        ollamaCapabilityCache.set(cacheKey, false)
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
    if (!toolUses.length || finishReason === 'stop' || finishReason === 'length') {
      return displayText || bufferedText
    }

    // Model called tools — execute them and loop
    await executeToolUses(db, rt, io, hookRt, toolUses)
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

// ─── Main entry point ─────────────────────────────────────────

export async function runUserTurn(db, rt, userText, io) {
  rt._userText = userText
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
      setPhase(db, rt.conversationId, 'explore', 'user_confirmed')
      appendEntry(db, rt.sessionId, 'user', makeUserPayload(buildExploreUserMessage(userText)))
    } else {
      appendEntry(db, rt.sessionId, 'user', makeUserPayload(userText))
    }
  } else {
    appendEntry(db, rt.sessionId, 'user', makeUserPayload(userText))
  }

  let model
  try { model = resolveWireModel(rt.settings.model_config) } catch (e) { io.println(`[config] ${e.message}`); return }
  rt._model = model

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

  if (phase === 'idle') {
    const text = await runAnthropicPhase(db, rt, io, hookRt, client, tools, phase)
    if (text) io.write(text)
    return
  }

  while (['explore', 'planning', 'implement', 'test'].includes(phase)) {
    const text = await runAnthropicPhase(db, rt, io, hookRt, client, tools, phase)
    if (text === null) return

    let advanced = false

    if (phase === 'explore') {
      advanced = await exploreGate(db, rt, io, rt._userText)
    } else if (phase === 'planning') {
      advanced = await planGate(db, rt, io, text)
    } else if (phase === 'implement') {
      const toolResults = extractRecentToolResults(db, rt.sessionId)
      const summary = await runAnthropicSummaryTurn(db, rt, io, hookRt, client, buildImplementSummaryPrompt(toolResults))
      advanced = await implementGate(db, rt, io, summary)
    } else if (phase === 'test') {
      const toolResults = extractRecentToolResults(db, rt.sessionId)
      const summary = await runAnthropicSummaryTurn(db, rt, io, hookRt, client, buildTestSummaryPrompt(toolResults))
      advanced = await testGate(db, rt, io, summary)
    }

    if (!advanced) break

    phase = getPhase(db, rt.conversationId)
    if (phase === 'idle') break

    // explore→planning transition injects its own message inside exploreGate.
    // For implement and test we inject the structured template here.
    if (phase === 'implement') {
      const plan = db.prepare(`SELECT content FROM plans WHERE conversation_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1`).get(rt.conversationId)
      appendEntry(db, rt.sessionId, 'user', makeUserPayload(buildImplementUserMessage(plan?.content || '')))
    } else if (phase === 'test') {
      appendEntry(db, rt.sessionId, 'user', makeUserPayload(buildTestUserMessage()))
    }
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

  const forceManual = rt.settings?.model_config?.force_manual_tools === true

  let nativeSupport = true
  if (provider === 'ollama') nativeSupport = await detectOllamaToolSupport(baseUrl, model)

  const { openai: allTools } = toolsForProvider(provider, nativeSupport)
  const injectedTools = (forceManual || !nativeSupport) ? allTools : null

  let phase = startPhase

  if (phase === 'idle') {
    const text = await runOpenAICompatPhase(db, rt, io, hookRt, provider, baseUrl, apiKey, allTools, injectedTools, phase)
    if (text) io.write(text)
    return
  }

  while (['explore', 'planning', 'implement', 'test'].includes(phase)) {
    const text = await runOpenAICompatPhase(db, rt, io, hookRt, provider, baseUrl, apiKey, allTools, injectedTools, phase)
    if (text === null) return

    let advanced = false

    if (phase === 'explore') {
      advanced = await exploreGate(db, rt, io, rt._userText)
    } else if (phase === 'planning') {
      advanced = await planGate(db, rt, io, text)
    } else if (phase === 'implement') {
      const toolResults = extractRecentToolResults(db, rt.sessionId)
      const summary = await runOpenAICompatSummaryTurn(db, rt, io, hookRt, provider, baseUrl, apiKey, buildImplementSummaryPrompt(toolResults))
      advanced = await implementGate(db, rt, io, summary)
    } else if (phase === 'test') {
      const toolResults = extractRecentToolResults(db, rt.sessionId)
      const summary = await runOpenAICompatSummaryTurn(db, rt, io, hookRt, provider, baseUrl, apiKey, buildTestSummaryPrompt(toolResults))
      advanced = await testGate(db, rt, io, summary)
    }

    if (!advanced) break

    phase = getPhase(db, rt.conversationId)
    if (phase === 'idle') break

    // explore→planning transition injects its own message inside exploreGate.
    // For implement and test we inject the structured template here.
    if (phase === 'implement') {
      const plan = db.prepare(`SELECT content FROM plans WHERE conversation_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1`).get(rt.conversationId)
      appendEntry(db, rt.sessionId, 'user', makeUserPayload(buildImplementUserMessage(plan?.content || '')))
    } else if (phase === 'test') {
      appendEntry(db, rt.sessionId, 'user', makeUserPayload(buildTestUserMessage()))
    }
  }
}
