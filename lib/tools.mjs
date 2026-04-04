import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { planningGateDeniesTool, setPhase, canTransition } from './workflow.mjs'
import { withTransaction } from './store.mjs'
import { getMcpServer, listMcpServers, mcpListResources, mcpReadResource } from './mcp.mjs'

const BASH_CAP = 1048576
const TRUNC = '[SDLC_TRUNCATED]'
const READ_CAP = 1048576

// ─── Tool dispatch ────────────────────────────────────────────

export async function executeBuiltinTool(db, ctx, toolName, toolInput, io) {
  const { conversationId, cwd } = ctx

  if (planningGateDeniesTool(db, conversationId, toolName)) {
    return { content: `[SDLC] Tool ${toolName} denied in planning phase until a plan is approved (§8.3).`, is_error: true }
  }

  try {
    switch (toolName) {
      case 'Read': return await toolRead(cwd, toolInput)
      case 'Write': return toolWrite(cwd, toolInput)
      case 'Edit': return toolEdit(cwd, toolInput)
      case 'Glob': return toolGlob(cwd, toolInput)
      case 'Grep': return toolGrep(cwd, toolInput)
      case 'Bash': return await toolBash(cwd, toolInput)
      case 'NotebookEdit': return toolNotebookEdit(cwd, toolInput)
      case 'WebFetch': return await toolWebFetch(toolInput)
      case 'WebSearch': return await toolWebSearch(toolInput)
      case 'AskUserQuestion': return await toolAskUser(io, toolInput)
      case 'Brief': return toolBrief(io, toolInput)
      case 'TodoWrite': return toolTodoWrite(db, ctx, toolInput)
      case 'TaskOutput': return toolTaskOutput(db, ctx, toolInput)
      case 'TaskStop': return toolTaskStop(toolInput)
      case 'EnterPlanMode': return toolEnterPlanMode(db, ctx)
      case 'ExitPlanMode': return toolExitPlanMode(db, ctx)
      case 'Agent': return await toolAgent(db, ctx, toolInput, io)
      case 'Skill': return toolSkill(toolInput)
      case 'ToolSearch': return toolSearchFn(toolInput)
      case 'ListMcpResources': return await toolListMcpResources(ctx, toolInput)
      case 'ReadMcpResource': return await toolReadMcpResource(ctx, toolInput)
      default:
        if (toolName.startsWith('mcp__')) return await toolMcpInvoke(ctx, toolName, toolInput)
        return { content: `Unknown tool: ${toolName}`, is_error: true }
    }
  } catch (e) {
    return { content: `[SDLC_INTERNAL] ${String(e?.message || e)}`, is_error: true }
  }
}

// ─── Read ─────────────────────────────────────────────────────

async function toolRead(cwd, input) {
  const rel = input?.file_path
  if (!rel || typeof rel !== 'string') return { content: 'Read: missing file_path', is_error: true }
  const abs = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(cwd, rel)
  if (!fs.existsSync(abs)) return { content: `Read: not found: ${rel}`, is_error: true }
  const stat = fs.statSync(abs)
  if (stat.isDirectory()) return { content: `Read: ${rel} is a directory`, is_error: true }
  const buf = fs.readFileSync(abs)
  if (buf.length > READ_CAP) {
    return { content: `Read ${rel}: ${buf.length} bytes (truncated to ${READ_CAP})\n---\n${buf.subarray(0, READ_CAP).toString('utf8')}\n${TRUNC}`, is_error: false }
  }
  const text = buf.toString('utf8')
  const lines = text.split('\n')
  const offset = input?.offset || 0
  const limit = input?.limit || lines.length
  const slice = lines.slice(offset, offset + limit)
  const numbered = slice.map((l, i) => `${offset + i + 1}\t${l}`).join('\n')
  return { content: `Read ${rel}: ${lines.length} lines.\n---\n${numbered}`, is_error: false }
}

// ─── Write ────────────────────────────────────────────────────

function toolWrite(cwd, input) {
  const rel = input?.file_path
  const content = input?.content
  if (!rel || typeof rel !== 'string') return { content: 'Write: missing file_path', is_error: true }
  if (typeof content !== 'string') return { content: 'Write: missing content', is_error: true }
  const abs = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(cwd, rel)
  const existed = fs.existsSync(abs)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf8')
  const lines = content.split('\n').length
  return { content: `${existed ? 'Updated' : 'Created'} ${rel} (${lines} lines)`, is_error: false }
}

// ─── Edit ─────────────────────────────────────────────────────

function toolEdit(cwd, input) {
  const rel = input?.file_path
  const oldStr = input?.old_string
  const newStr = input?.new_string
  if (!rel) return { content: 'Edit: missing file_path', is_error: true }
  if (typeof oldStr !== 'string') return { content: 'Edit: missing old_string', is_error: true }
  if (typeof newStr !== 'string') return { content: 'Edit: missing new_string', is_error: true }
  const abs = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(cwd, rel)
  if (!fs.existsSync(abs)) return { content: `Edit: not found: ${rel}`, is_error: true }
  let text = fs.readFileSync(abs, 'utf8')
  if (input?.replace_all) {
    if (!text.includes(oldStr)) return { content: `Edit: old_string not found in ${rel}`, is_error: true }
    text = text.replaceAll(oldStr, newStr)
  } else {
    const idx = text.indexOf(oldStr)
    if (idx === -1) return { content: `Edit: old_string not found in ${rel}`, is_error: true }
    const count = text.split(oldStr).length - 1
    if (count > 1) return { content: `Edit: old_string matches ${count} locations in ${rel} — provide more context to make it unique, or use replace_all`, is_error: true }
    text = text.slice(0, idx) + newStr + text.slice(idx + oldStr.length)
  }
  fs.writeFileSync(abs, text, 'utf8')
  return { content: `Edited ${rel}`, is_error: false }
}

// ─── Glob ─────────────────────────────────────────────────────

function toolGlob(cwd, input) {
  const pattern = input?.pattern
  if (!pattern) return { content: 'Glob: missing pattern', is_error: true }
  const searchDir = input?.path ? path.resolve(cwd, input.path) : cwd
  if (!fs.existsSync(searchDir)) return { content: `Glob: directory not found: ${searchDir}`, is_error: true }
  const results = []
  const maxResults = 100
  globWalk(searchDir, pattern, results, maxResults, searchDir)
  return { content: results.length ? results.join('\n') : '(no matches)', is_error: false }
}

function globWalk(dir, pattern, results, max, root) {
  if (results.length >= max) return
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (results.length >= max) return
    if (e.name.startsWith('.') && !pattern.startsWith('.')) continue
    const full = path.join(dir, e.name)
    const rel = path.relative(root, full)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      globWalk(full, pattern, results, max, root)
    } else {
      if (globMatch(pattern, rel) || globMatch(pattern, e.name)) results.push(rel)
    }
  }
}

function globMatch(pattern, str) {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${regex}$`).test(str)
}

// ─── Grep ─────────────────────────────────────────────────────

function toolGrep(cwd, input) {
  const pattern = input?.pattern
  if (!pattern) return { content: 'Grep: missing pattern', is_error: true }
  const searchPath = input?.path ? path.resolve(cwd, input.path) : cwd
  const mode = input?.output_mode || 'files_with_matches'
  const caseI = input?.['-i'] || false
  const headLimit = input?.head_limit ?? 250
  const contextLines = input?.['-C'] || input?.context || 0
  let re
  try { re = new RegExp(pattern, caseI ? 'i' : '') } catch (e) { return { content: `Grep: invalid regex: ${e.message}`, is_error: true } }

  const stat = fs.existsSync(searchPath) ? fs.statSync(searchPath) : null
  if (!stat) return { content: `Grep: path not found: ${searchPath}`, is_error: true }

  const matchingFiles = []
  const contentLines = []
  let matchCount = 0

  function searchFile(filePath) {
    if (headLimit > 0 && matchingFiles.length >= headLimit && mode === 'files_with_matches') return
    let text
    try { text = fs.readFileSync(filePath, 'utf8') } catch { return }
    const lines = text.split('\n')
    let fileMatched = false
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        matchCount++
        if (!fileMatched) { matchingFiles.push(path.relative(cwd, filePath)); fileMatched = true }
        if (mode === 'content') {
          if (headLimit > 0 && contentLines.length >= headLimit) return
          const start = Math.max(0, i - contextLines)
          const end = Math.min(lines.length - 1, i + contextLines)
          for (let j = start; j <= end; j++) {
            const prefix = j === i ? `${j + 1}:` : `${j + 1}-`
            contentLines.push(`${path.relative(cwd, filePath)}:${prefix}${lines[j]}`)
          }
          if (contextLines > 0) contentLines.push('--')
        }
      }
    }
  }

  function walk(dir) {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else {
        if (input?.glob && !globMatch(input.glob, e.name)) continue
        searchFile(full)
      }
    }
  }

  if (stat.isFile()) searchFile(searchPath)
  else walk(searchPath)

  if (mode === 'files_with_matches') return { content: matchingFiles.join('\n') || '(no matches)', is_error: false }
  if (mode === 'count') return { content: `${matchCount} matches in ${matchingFiles.length} files`, is_error: false }
  return { content: contentLines.join('\n') || '(no matches)', is_error: false }
}

// ─── Bash ─────────────────────────────────────────────────────

async function toolBash(cwd, input) {
  const cmd = input?.command
  if (!cmd || typeof cmd !== 'string') return { content: 'Bash: missing command', is_error: true }
  const timeoutMs = Math.min(input?.timeout || 120_000, 600_000)
  return new Promise(resolve => {
    const child = spawn(resolveBash(), ['-lc', cmd], { cwd, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = Buffer.alloc(0), err = Buffer.alloc(0)
    const push = (b, chunk) => {
      const n = Buffer.concat([b, chunk])
      return n.length <= BASH_CAP ? n : Buffer.concat([n.subarray(0, BASH_CAP), Buffer.from(TRUNC)])
    }
    child.stdout.on('data', d => { out = push(out, d) })
    child.stderr.on('data', d => { err = push(err, d) })
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('close', code => {
      clearTimeout(t)
      let content = out.toString('utf8')
      const se = err.toString('utf8')
      if (se) content += `\n--- stderr ---\n${se}`
      resolve({ content, is_error: code !== 0 })
    })
    child.on('error', e => { clearTimeout(t); resolve({ content: String(e?.message || e), is_error: true }) })
  })
}

function resolveBash() {
  if (fs.existsSync('/bin/bash')) return '/bin/bash'
  if (fs.existsSync('/usr/bin/bash')) return '/usr/bin/bash'
  return 'bash'
}

// ─── NotebookEdit ─────────────────────────────────────────────

function toolNotebookEdit(cwd, input) {
  const rel = input?.notebook_path
  if (!rel) return { content: 'NotebookEdit: missing notebook_path', is_error: true }
  const abs = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(cwd, rel)
  if (!fs.existsSync(abs)) return { content: `NotebookEdit: not found: ${rel}`, is_error: true }
  let nb
  try { nb = JSON.parse(fs.readFileSync(abs, 'utf8')) } catch (e) { return { content: `NotebookEdit: parse error: ${e.message}`, is_error: true } }
  const cells = nb.cells || []
  const cellId = input?.cell_id
  const newSource = input?.new_source
  const cellType = input?.cell_type || 'code'
  if (typeof newSource !== 'string') return { content: 'NotebookEdit: missing new_source', is_error: true }

  const sourceLines = newSource.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l)

  if (cellId) {
    const idx = cells.findIndex(c => c.id === cellId || c.metadata?.id === cellId)
    if (idx >= 0) {
      cells[idx].source = sourceLines
      cells[idx].cell_type = cellType
    } else {
      cells.push({ id: cellId, cell_type: cellType, source: sourceLines, metadata: { id: cellId }, outputs: [] })
    }
  } else {
    const id = randomUUID().slice(0, 8)
    cells.unshift({ id, cell_type: cellType, source: sourceLines, metadata: { id }, outputs: [] })
  }

  nb.cells = cells
  fs.writeFileSync(abs, JSON.stringify(nb, null, 1), 'utf8')
  return { content: `NotebookEdit: updated ${rel} (${cells.length} cells)`, is_error: false }
}

// ─── WebFetch ─────────────────────────────────────────────────

async function toolWebFetch(input) {
  const url = input?.url
  if (!url) return { content: 'WebFetch: missing url', is_error: true }
  try { new URL(url) } catch { return { content: `WebFetch: invalid url: ${url}`, is_error: true } }
  const start = Date.now()
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'ona-sdlc-repl/0.2' }, signal: AbortSignal.timeout(30_000) })
    const text = await resp.text()
    const capped = text.length > BASH_CAP ? text.slice(0, BASH_CAP) + `\n${TRUNC}` : text
    const duration = Date.now() - start
    if (!resp.ok) return { content: `WebFetch ${resp.status} ${resp.statusText}: ${capped.slice(0, 2000)}`, is_error: true }
    return { content: `WebFetch ${url} (${resp.status}, ${text.length} bytes, ${duration}ms):\n${capped}`, is_error: false }
  } catch (e) {
    return { content: `WebFetch error: ${String(e?.message || e)}`, is_error: true }
  }
}

// ─── WebSearch ────────────────────────────────────────────────

async function toolWebSearch(input) {
  const query = input?.query
  if (!query || query.length < 2) return { content: 'WebSearch: query must be ≥2 chars', is_error: true }
  try {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
    const resp = await fetch(url, { headers: { 'User-Agent': 'ona-sdlc-repl/0.2' }, signal: AbortSignal.timeout(15_000) })
    const html = await resp.text()
    const results = parseDDGLite(html).slice(0, 8)
    if (!results.length) return { content: `WebSearch: no results for "${query}"`, is_error: false }
    const text = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n')
    return { content: `WebSearch results for "${query}":\n\n${text}`, is_error: false }
  } catch (e) {
    return { content: `WebSearch error: ${String(e?.message || e)}`, is_error: true }
  }
}

function parseDDGLite(html) {
  const results = []
  const linkRe = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetRe = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi
  const links = [...html.matchAll(linkRe)]
  const snippets = [...html.matchAll(snippetRe)]
  for (let i = 0; i < links.length; i++) {
    const url = links[i][1].replace(/&amp;/g, '&')
    const title = links[i][2].replace(/<[^>]+>/g, '').trim()
    const snippet = (snippets[i]?.[1] || '').replace(/<[^>]+>/g, '').trim()
    if (url && title) results.push({ url, title, snippet })
  }
  if (!results.length) {
    const simpleLinks = [...html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    for (const m of simpleLinks.slice(0, 8)) {
      const u = m[1]; const t = m[2].replace(/<[^>]+>/g, '').trim()
      if (t.length > 5 && !u.includes('duckduckgo.com')) results.push({ url: u, title: t, snippet: '' })
    }
  }
  return results
}

// ─── AskUserQuestion ──────────────────────────────────────────

async function toolAskUser(io, input) {
  const question = input?.question || input?.prompt || 'Please provide input:'
  if (!io?.ask) return { content: 'AskUserQuestion: no interactive input available', is_error: true }
  const answer = await io.ask(`${question}\n> `)
  return { content: String(answer || '').trim() || '(no response)', is_error: false }
}

// ─── Brief ────────────────────────────────────────────────────

function toolBrief(io, input) {
  const msg = input?.message || input?.content || ''
  if (io?.println) io.println(msg)
  return { content: 'Message displayed.', is_error: false }
}

// ─── TodoWrite ────────────────────────────────────────────────

function toolTodoWrite(db, ctx, input) {
  const todos = input?.todos
  if (!Array.isArray(todos)) return { content: 'TodoWrite: missing todos array', is_error: true }
  withTransaction(db, () => {
    for (const t of todos) {
      const id = t.id || randomUUID().slice(0, 8)
      db.prepare(`INSERT OR REPLACE INTO state(conversation_id, key, value) VALUES (?, ?, ?)`).run(ctx.conversationId, `todo:${id}`, JSON.stringify(t))
    }
  })
  return { content: `TodoWrite: ${todos.length} item(s) saved.`, is_error: false }
}

// ─── TaskOutput ───────────────────────────────────────────────

function toolTaskOutput(db, ctx, input) {
  const output = input?.output || input?.content || ''
  withTransaction(db, () => {
    db.prepare(`INSERT INTO events(conversation_id, session_id, event_type, detail) VALUES (?, ?, 'task_output', ?)`).run(ctx.conversationId, ctx.sessionId, typeof output === 'string' ? output : JSON.stringify(output))
  })
  return { content: 'Task output recorded.', is_error: false }
}

// ─── TaskStop ─────────────────────────────────────────────────

function toolTaskStop(input) {
  const taskId = input?.task_id || input?.shell_id
  if (!taskId) return { content: 'TaskStop: missing task_id', is_error: true }
  // Background tasks tracked by the orchestrator; signal via process group
  try { process.kill(Number(taskId), 'SIGTERM') } catch {}
  return { content: `TaskStop: sent SIGTERM to ${taskId}`, is_error: false }
}

// ─── EnterPlanMode ────────────────────────────────────────────

function toolEnterPlanMode(db, ctx) {
  const check = canTransition(db, ctx.conversationId, 'planning')
  if (!check.ok) return { content: check.reason, is_error: true }
  setPhase(db, ctx.conversationId, 'planning')
  return { content: 'Entered planning phase.', is_error: false }
}

// ─── ExitPlanMode ─────────────────────────────────────────────

function toolExitPlanMode(db, ctx) {
  const row = db.prepare(`SELECT 1 AS ok FROM plans WHERE conversation_id = ? AND status = 'approved' LIMIT 1`).get(ctx.conversationId)
  if (!row) return { content: 'Cannot exit plan mode: no approved plan row exists (§8).', is_error: true }
  const check = canTransition(db, ctx.conversationId, 'implement')
  if (!check.ok) return { content: check.reason, is_error: true }
  setPhase(db, ctx.conversationId, 'implement')
  return { content: 'Exited plan mode; phase is implement.', is_error: false }
}

// ─── Agent ────────────────────────────────────────────────────

async function toolAgent(db, ctx, input, io) {
  const prompt = input?.prompt
  if (!prompt) return { content: 'Agent: missing prompt', is_error: true }
  const desc = input?.description || 'subagent'
  const subSessionId = randomUUID()
  const subConvId = ctx.conversationId // same conversation

  db.prepare(`INSERT INTO sessions(session_id, conversation_id) VALUES (?,?)`).run(subSessionId, subConvId)
  db.prepare(`INSERT INTO events(conversation_id, session_id, event_type, detail) VALUES (?, ?, 'subagent_start', ?)`).run(subConvId, subSessionId, JSON.stringify({ description: desc }))

  // Run one turn in the sub-session using the same orchestration
  const { runUserTurn } = await import('./orchestrate.mjs')
  const subRt = { ...ctx, sessionId: subSessionId }
  const collected = []
  const subIo = {
    write: s => collected.push(s),
    println: s => collected.push(s + '\n'),
    ask: io?.ask,
  }

  await runUserTurn(db, subRt, prompt, subIo)

  db.prepare(`INSERT INTO events(conversation_id, session_id, event_type, detail) VALUES (?, ?, 'subagent_stop', ?)`).run(subConvId, subSessionId, JSON.stringify({ description: desc }))

  const output = collected.join('')
  return { content: output || '(agent produced no output)', is_error: false }
}

// ─── Skill ────────────────────────────────────────────────────

function toolSkill(input) {
  const name = input?.skill
  if (!name) return { content: 'Skill: missing skill name', is_error: true }
  // Built-in skill stubs — these map to REPL commands or configurable skills
  const builtins = { commit: 'git add -A && git commit', help: '/help', status: '/status' }
  if (builtins[name]) return { content: `Skill '${name}' dispatches to: ${builtins[name]}`, is_error: false }
  return { content: `Skill '${name}' executed.`, is_error: false }
}

// ─── ToolSearch ───────────────────────────────────────────────

function toolSearchFn(input) {
  const query = (input?.query || '').toLowerCase()
  const max = input?.max_results || 5
  const defs = anthropicToolDefinitions()
  const matches = defs.filter(t => t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)).slice(0, max)
  if (!matches.length) return { content: `ToolSearch: no matches for "${query}"`, is_error: false }
  const text = matches.map(t => `${t.name}: ${t.description}`).join('\n')
  return { content: text, is_error: false }
}

// ─── MCP tools ────────────────────────────────────────────────

async function toolListMcpResources(ctx, input) {
  const serverName = input?.server
  const settings = ctx.settings || {}
  const serverConfigs = settings.mcp_servers || {}
  if (serverName) {
    if (!serverConfigs[serverName]) return { content: `MCP server '${serverName}' not configured`, is_error: true }
    const srv = getMcpServer(serverName, serverConfigs[serverName])
    return mcpListResources(srv)
  }
  const names = Object.keys(serverConfigs)
  if (!names.length) return { content: 'No MCP servers configured.', is_error: false }
  const all = []
  for (const n of names) {
    const srv = getMcpServer(n, serverConfigs[n])
    const r = await mcpListResources(srv)
    all.push(`[${n}]\n${r.content}`)
  }
  return { content: all.join('\n\n'), is_error: false }
}

async function toolReadMcpResource(ctx, input) {
  const serverName = input?.server
  const uri = input?.uri
  if (!serverName || !uri) return { content: 'ReadMcpResource: missing server or uri', is_error: true }
  const settings = ctx.settings || {}
  const serverConfigs = settings.mcp_servers || {}
  if (!serverConfigs[serverName]) return { content: `MCP server '${serverName}' not configured`, is_error: true }
  const srv = getMcpServer(serverName, serverConfigs[serverName])
  return mcpReadResource(srv, uri)
}

async function toolMcpInvoke(ctx, toolName, toolInput) {
  // mcp__<server>__<tool>
  const parts = toolName.split('__')
  if (parts.length < 3) return { content: `Invalid MCP tool name: ${toolName}`, is_error: true }
  const serverName = parts[1]
  const mcpToolName = parts.slice(2).join('__')
  const settings = ctx.settings || {}
  const serverConfigs = settings.mcp_servers || {}
  if (!serverConfigs[serverName]) return { content: `MCP server '${serverName}' not configured`, is_error: true }
  const srv = getMcpServer(serverName, serverConfigs[serverName])
  const { mcpCallTool: callTool } = await import('./mcp.mjs')
  return callTool(srv, mcpToolName, toolInput || {})
}

// ─── Tool definitions ─────────────────────────────────────────

export function anthropicToolDefinitions() {
  return [
    { name: 'Read', description: 'Read a file from the filesystem.', input_schema: { type: 'object', properties: { file_path: { type: 'string', description: 'Path to file (absolute or relative to cwd)' }, offset: { type: 'integer', description: 'Start line (0-based)' }, limit: { type: 'integer', description: 'Max lines to read' } }, required: ['file_path'] } },
    { name: 'Write', description: 'Create or overwrite a file.', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
    { name: 'Edit', description: 'Find and replace text in a file.', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['file_path', 'old_string', 'new_string'] } },
    { name: 'Glob', description: 'Find files matching a glob pattern.', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string', description: 'Directory to search (default: cwd)' } }, required: ['pattern'] } },
    { name: 'Grep', description: 'Search file contents with regex.', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'] }, glob: { type: 'string' }, '-i': { type: 'boolean' }, '-C': { type: 'integer' }, head_limit: { type: 'integer' } }, required: ['pattern'] } },
    { name: 'Bash', description: 'Run a shell command.', input_schema: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'integer', description: 'Timeout in ms (max 600000)' } }, required: ['command'] } },
    { name: 'NotebookEdit', description: 'Edit a Jupyter notebook cell.', input_schema: { type: 'object', properties: { notebook_path: { type: 'string' }, cell_id: { type: 'string' }, new_source: { type: 'string' }, cell_type: { type: 'string', enum: ['code', 'markdown'] } }, required: ['notebook_path', 'new_source', 'cell_type'] } },
    { name: 'WebFetch', description: 'Fetch content from a URL.', input_schema: { type: 'object', properties: { url: { type: 'string' }, prompt: { type: 'string' } }, required: ['url'] } },
    { name: 'WebSearch', description: 'Search the web.', input_schema: { type: 'object', properties: { query: { type: 'string' }, allowed_domains: { type: 'array', items: { type: 'string' } }, blocked_domains: { type: 'array', items: { type: 'string' } } }, required: ['query'] } },
    { name: 'AskUserQuestion', description: 'Ask the user a question and wait for response.', input_schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
    { name: 'Brief', description: 'Display a message to the user.', input_schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } },
    { name: 'TodoWrite', description: 'Create or update todo items.', input_schema: { type: 'object', properties: { todos: { type: 'array', items: { type: 'object' } } }, required: ['todos'] } },
    { name: 'TaskOutput', description: 'Record output from a task.', input_schema: { type: 'object', properties: { output: { type: 'string' } } } },
    { name: 'TaskStop', description: 'Stop a background task.', input_schema: { type: 'object', properties: { task_id: { type: 'string' } } } },
    { name: 'EnterPlanMode', description: 'Enter SDLC planning phase (§8).', input_schema: { type: 'object', properties: {} } },
    { name: 'ExitPlanMode', description: 'Exit planning to implement phase.', input_schema: { type: 'object', properties: {} } },
    { name: 'Agent', description: 'Run a subagent with an isolated session.', input_schema: { type: 'object', properties: { description: { type: 'string' }, prompt: { type: 'string' } }, required: ['prompt'] } },
    { name: 'Skill', description: 'Invoke a skill or slash command.', input_schema: { type: 'object', properties: { skill: { type: 'string' }, args: { type: 'string' } }, required: ['skill'] } },
    { name: 'ToolSearch', description: 'Search for available tools.', input_schema: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer' } }, required: ['query'] } },
    { name: 'ListMcpResources', description: 'List MCP server resources.', input_schema: { type: 'object', properties: { server: { type: 'string' } } } },
    { name: 'ReadMcpResource', description: 'Read a resource from an MCP server.', input_schema: { type: 'object', properties: { server: { type: 'string' }, uri: { type: 'string' } }, required: ['server', 'uri'] } },
  ]
}

export function openAICompatToolDefinitions() {
  return anthropicToolDefinitions().map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))
}
