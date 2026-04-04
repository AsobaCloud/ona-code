import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { withTransaction } from './store.mjs'

const MAX_CAPTURE = 4194304
const TRUNC_MARK = '\n[SDLC_OUTPUT_TRUNCATED]\n'

function hookTimeoutMs(eventName) {
  if (eventName === 'SessionEnd') {
    const v = Number(process.env.SDLC_SESSIONEND_HOOK_TIMEOUT_MS)
    return Number.isFinite(v) && v > 0 ? v : 1500
  }
  const v = Number(process.env.SDLC_HOOK_TIMEOUT_MS)
  return Number.isFinite(v) && v > 0 ? v : 600000
}

/** §5.1 — matcher against event-specific field. */
export function matcherMatches(hookEventName, matcher, ctx) {
  const m = matcher == null || matcher === '' ? '' : String(matcher)
  if (m === '' || m === '*') return true

  const toolish = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied'])
  if (toolish.has(hookEventName)) return matchValue(m, ctx.tool_name || '')
  if (hookEventName === 'SessionStart') return matchValue(m, ctx.source || '')
  if (hookEventName === 'Setup' || hookEventName === 'PreCompact' || hookEventName === 'PostCompact') return matchValue(m, ctx.trigger || '')
  if (hookEventName === 'Notification') return matchValue(m, ctx.notification_type || '')
  if (hookEventName === 'SessionEnd') return matchValue(m, ctx.reason || '')
  if (hookEventName === 'StopFailure') return matchValue(m, String(ctx.error || ''))
  if (hookEventName === 'SubagentStart' || hookEventName === 'SubagentStop') return matchValue(m, ctx.agent_type || '')
  if (hookEventName === 'Elicitation' || hookEventName === 'ElicitationResult') return matchValue(m, ctx.mcp_server_name || '')
  if (hookEventName === 'ConfigChange') return matchValue(m, ctx.source || '')
  if (hookEventName === 'InstructionsLoaded') return matchValue(m, ctx.load_reason || '')
  if (hookEventName === 'FileChanged') {
    const base = ctx.file_path ? ctx.file_path.split(/[/\\]/).pop() : ''
    return matchValue(m, base)
  }
  return true
}

function matchValue(matcher, value) {
  if (/^[a-zA-Z0-9_|]+$/.test(matcher) && matcher.includes('|')) {
    return matcher.split('|').includes(value)
  }
  try { return new RegExp(matcher).test(value) } catch { return false }
}

function baseHookInput(hook_event_name, rt) {
  const o = {
    hook_event_name,
    session_id: rt.sessionId,
    conversation_id: rt.conversationId,
    runtime_db_path: rt.runtimeDbPath,
    cwd: rt.cwd,
  }
  if (rt.permissionMode != null) o.permission_mode = rt.permissionMode
  if (rt.agentId != null) o.agent_id = rt.agentId
  if (rt.agentType != null) o.agent_type = rt.agentType
  return o
}

function hooksForEvent(settings, eventName) {
  const raw = settings?.hooks
  if (!Array.isArray(raw)) return []
  return raw.filter(h => h && h.hook_event_name === eventName)
}

/** §5.3 — sequential hooks; §5.6 blocking merge; §5.8 async rejection. */
export async function runHooks(db, rt, eventName, eventFields) {
  if (process.env.SDLC_DISABLE_ALL_HOOKS === '1') return { ok: true, preTool: null, userPrompt: null }

  const list = hooksForEvent(rt.settings, eventName)
  let ordinal = 0
  const preAgg = { permission: 'unset', blocks: [], skipRest: false }
  let userPromptCtx = null

  for (const h of list) {
    if (preAgg.skipRest) {
      persistSkipped(db, rt, eventName, ordinal, h, eventFields, 'prior_block_or_deny')
      ordinal++
      continue
    }
    if (!matcherMatches(eventName, h.matcher, { ...rt, ...eventFields })) continue

    const shell = h.shell === 'powershell' || h.shell === 'sh' ? h.shell : 'bash'
    const stdinObj = { ...baseHookInput(eventName, rt), ...eventFields }
    const inputJson = JSON.stringify(stdinObj)
    const started = new Date().toISOString()

    const { exitCode, stdout, stderr } = await runHookCommand(shell, h.command, stdinObj, rt.cwd, rt.runtimeDbPath, hookTimeoutMs(eventName))
    const completed = new Date().toISOString()

    withTransaction(db, () => {
      db.prepare(
        `INSERT INTO hook_invocations(session_id, conversation_id, hook_event, hook_ordinal, matcher, command, tool_use_id, tool_name, input_json, exit_code, stdout_text, stderr_text, started_at, completed_at, skipped_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(rt.sessionId, rt.conversationId, eventName, ordinal, String(h.matcher ?? ''), String(h.command ?? ''), eventFields.tool_use_id ?? null, eventFields.tool_name ?? null, inputJson, exitCode, stdout, stderr, started, completed, null)
    })
    ordinal++

    const parsed = parseHookStdout(stdout)
    if (parsed.asyncInvalid) console.error('[SDLC] hook rejected async:true control (§5.8)')

    if (eventName === 'PreToolUse') {
      mergePreToolUse(preAgg, parsed, exitCode, stderr, ordinal - 1)
      if (preAgg.skipRest) continue
    } else if (eventName === 'UserPromptSubmit' && exitCode === 2) {
      userPromptCtx = { blocked: true, stderr, ordinal: ordinal - 1 }
      break
    }
  }

  if (eventName === 'PreToolUse') {
    const denied = preAgg.permission === 'deny' || preAgg.blocks.length > 0
    let message = ''
    if (preAgg.blocks.length) {
      message = preAgg.blocks.sort((a, b) => a.ordinal - b.ordinal).map(b => `[${b.ordinal}] ${b.stderr}`).join('\n')
    }
    return {
      ok: !denied,
      preTool: denied ? { denied: true, message } : { denied: false, hookAsk: preAgg.permission === 'ask' },
      userPrompt: null,
    }
  }

  if (eventName === 'UserPromptSubmit') {
    return { ok: !userPromptCtx?.blocked, preTool: null, userPrompt: userPromptCtx }
  }

  return { ok: true, preTool: null, userPrompt: null }
}

function persistSkipped(db, rt, eventName, ordinal, h, eventFields, reason) {
  const stdinObj = { ...baseHookInput(eventName, rt), ...eventFields }
  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO hook_invocations(session_id, conversation_id, hook_event, hook_ordinal, matcher, command, tool_use_id, tool_name, input_json, exit_code, stdout_text, stderr_text, started_at, completed_at, skipped_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(rt.sessionId, rt.conversationId, eventName, ordinal, String(h.matcher ?? ''), String(h.command ?? ''), eventFields.tool_use_id ?? null, eventFields.tool_name ?? null, JSON.stringify(stdinObj), null, null, null, new Date().toISOString(), null, reason)
  })
}

function mergePreToolUse(agg, parsed, exitCode, stderr, ord) {
  const dec = parsed.hookSpecificOutput?.permissionDecision
  if (dec === 'deny' || dec === 'ask' || dec === 'allow') {
    const rank = { unset: 0, allow: 1, ask: 2, deny: 3 }
    if ((rank[dec] ?? 0) > (rank[agg.permission] ?? 0)) agg.permission = dec
  }
  if (exitCode === 2) agg.blocks.push({ ordinal: ord, stderr: stderr || '' })
  if (agg.permission === 'deny' || agg.blocks.length > 0) agg.skipRest = true
}

function parseHookStdout(stdout) {
  const t = (stdout || '').trim()
  if (!t.startsWith('{')) return {}
  try {
    const j = JSON.parse(t)
    if (j && j.async === true) return { asyncInvalid: true }
    return j
  } catch { return {} }
}

function resolveBash() {
  if (fs.existsSync('/bin/bash')) return '/bin/bash'
  if (fs.existsSync('/usr/bin/bash')) return '/usr/bin/bash'
  return 'bash'
}

async function runHookCommand(shell, commandString, stdinObj, cwd, runtimeDbPath, timeoutMs) {
  const payload = JSON.stringify(stdinObj) + '\n'
  if (!fs.existsSync(cwd)) return { exitCode: null, stdout: '', stderr: `hook cwd does not exist: ${cwd}` }

  const env = { ...process.env, AGENT_SDLC_DB: runtimeDbPath, SDLC_HOOK: '1' }
  if (!env.LANG && !env.LC_ALL) env.LANG = 'C.UTF-8'

  let child
  try {
    if (shell === 'bash') child = spawn(resolveBash(), ['-lc', commandString], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    else if (shell === 'sh') child = spawn('/bin/sh', ['-c', commandString], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    else child = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-Command', commandString], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (e) {
    return { exitCode: null, stdout: '', stderr: String(e?.message || e) }
  }

  const stdoutP = cappedRead(child.stdout, MAX_CAPTURE)
  const stderrP = cappedRead(child.stderr, MAX_CAPTURE)
  child.stdin.write(payload, 'utf8')
  child.stdin.end()

  const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, timeoutMs)
  let exitCode = null
  try {
    exitCode = await new Promise((resolve) => {
      child.on('error', () => resolve(null))
      child.on('close', c => resolve(c))
    })
  } finally { clearTimeout(timer) }

  return { exitCode, stdout: await stdoutP, stderr: await stderrP }
}

function cappedRead(stream, maxBytes) {
  return new Promise(resolve => {
    let total = 0; const chunks = []; let truncated = false
    stream.on('data', buf => {
      if (truncated) return
      const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
      if (total + b.length <= maxBytes) { chunks.push(b); total += b.length }
      else {
        const rest = maxBytes - total
        if (rest > 0) chunks.push(b.subarray(0, rest))
        total = maxBytes; truncated = true
        try { stream.destroy() } catch {}
      }
    })
    stream.on('end', () => {
      let s = Buffer.concat(chunks).toString('utf8')
      if (truncated) s += TRUNC_MARK
      resolve(s)
    })
    stream.on('error', () => resolve(Buffer.concat(chunks).toString('utf8') + TRUNC_MARK))
  })
}
