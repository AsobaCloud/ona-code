#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import { openStore } from '../lib/store.mjs'
import { defaultDbPath } from '../lib/paths.mjs'
import { resolveAnthropicCredentials, authStatusSummary, saveSecureCredentials, clearSecureCredentials, interactiveOAuthLogin } from '../lib/auth.mjs'
import { bootstrapSettings, getEffectiveSettings, updateEffectiveSettings } from '../lib/settings.mjs'
import { resolveWireModel, allModelIds } from '../lib/modelConfig.mjs'
import { runHooks } from '../lib/hookplane.mjs'
import { runUserTurn } from '../lib/orchestrate.mjs'
import { closeAllMcpServers } from '../lib/mcp.mjs'
import { getPhase, canTransition, setPhase } from '../lib/workflow.mjs'
import { executeBuiltinTool } from '../lib/tools.mjs'
import { appendEntry, makeUserPayload, makeToolResultPayload } from '../lib/transcript.mjs'
import { loadInstructions } from '../lib/instructions.mjs'
import { compactConversation } from '../lib/compact.mjs'
import { createTeam, getTeam, listTeams, deleteTeam } from '../lib/team.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(__dirname, '..')

function parseArgs(argv) {
  const args = { bare: false, cwd: process.cwd(), help: false, eval: null, transition: null, conversation: null, initDb: false }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') args.help = true
    else if (argv[i] === '--bare') args.bare = true
    else if (argv[i] === '--cwd' && argv[i + 1]) args.cwd = path.resolve(argv[++i])
    else if (argv[i] === '--eval' && argv[i + 1]) args.eval = argv[++i]
    else if (argv[i] === '--transition' && argv[i + 1]) args.transition = argv[++i]
    else if (argv[i] === '--conversation' && argv[i + 1]) args.conversation = argv[++i]
    else if (argv[i] === '--init-db') args.initDb = true
  }
  return args
}

// ── Shared bootstrap ─────────────────────────────────────────
async function autoDetectLmStudioModel() {
  if (process.env.LM_STUDIO_MODEL) return
  try {
    const base = (process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1').replace(/\/$/, '')
    const resp = await fetch(`${base}/models`, { signal: AbortSignal.timeout(3000) })
    if (!resp.ok) return
    const data = await resp.json()
    const models = data?.data?.filter(m => m.id && !m.id.includes('embedding'))
    if (models?.length) process.env.LM_STUDIO_MODEL = models[0].id
  } catch { /* LM Studio not running — that's fine */ }
}

function bootstrap(opts) {
  const cwd = opts.cwd
  process.chdir(cwd)

  let dbPath = process.env.AGENT_SDLC_DB
  if (dbPath && !path.isAbsolute(dbPath)) dbPath = path.resolve(cwd, dbPath)
  if (!dbPath) dbPath = defaultDbPath()
  process.env.AGENT_SDLC_DB = dbPath

  const db = openStore(dbPath)
  let settings = bootstrapSettings(db, cwd)
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'))

  let conversationId = randomUUID()
  let sessionId = randomUUID()
  db.prepare(`INSERT INTO conversations(id, project_dir, phase) VALUES (?,?, 'idle')`).run(conversationId, cwd)
  db.prepare(`INSERT INTO sessions(session_id, conversation_id) VALUES (?,?)`).run(sessionId, conversationId)

  return { db, dbPath, settings, pkg, conversationId, sessionId, cwd }
}

// ── Interactive mode (TTY) — Ink-based UI ────────────────────
async function mainInteractive(opts) {
  const ctx = bootstrap(opts)
  let { db, dbPath, settings, pkg, conversationId, sessionId, cwd } = ctx

  const makeHookRt = () => ({
    sessionId, conversationId, runtimeDbPath: dbPath, cwd,
    permissionMode: settings.permissions?.defaultMode ?? 'default', settings,
  })

  // Load Ona.md instructions
  const { content: onaInstructions, path: onaPath } = loadInstructions(cwd)

  if (process.env.SDLC_DISABLE_ALL_HOOKS !== '1') {
    await runHooks(db, makeHookRt(), 'Setup', { trigger: 'init' })
    await runHooks(db, makeHookRt(), 'SessionStart', { source: 'startup', model: (() => { try { return resolveWireModel(settings.model_config) } catch { return '' } })() })
    if (onaPath) {
      await runHooks(db, makeHookRt(), 'InstructionsLoaded', { file_path: onaPath, memory_type: 'Project', load_reason: 'session_start' })
    }
  }

  // Resolve model info for banner
  let wireModel = '(not set)', endpoint = '(not configured)'
  const provider = settings.model_config?.provider || 'lm_studio_local'
  try {
    wireModel = resolveWireModel(settings.model_config)
    const base = (process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1').replace(/\/$/, '')
    endpoint = provider === 'lm_studio_local' ? `${base}/chat/completions`
      : provider === 'openai_compatible' ? `${process.env.OPENAI_BASE_URL || '(unset)'}/chat/completions`
      : `${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`
  } catch (e) { wireModel = `(${e.message})` }

  // Start Ink app
  const { startApp } = await import('../lib/app.mjs')
  const app = startApp({
    version: pkg.version,
    provider,
    wireModel,
    endpoint,
    dbPath,
    cwd,
    bare: opts.bare,
    permissionMode: settings.permissions?.defaultMode ?? 'default',
    onUserInput: async (text) => {
      await handleInput(text)
    },
    onExit: () => shutdown(),
  })

  async function handleInput(line) {
    const trimmed = line.trim()
    if (!trimmed) return

    // Slash commands
    if (trimmed === '/exit' || trimmed === '/quit') {
      await shutdown()
      return
    }

    if (trimmed === '/help') {
      app.addSystemMessage(`SDLC Status (read-only):
  /phase        Current phase
  /plan         Plan content
  /test         Test results
  /verify       Coverage report
  /code         Implementation status
  /done         Workflow status

Workflow transitions are automatic:
  Plan → approve → implement → SubmitImplementation → approve → tests → approve → done

Tools:
  /init         Create Ona.md
  /diff         Uncommitted changes
  /cost         Token usage
  /doctor       Diagnostics
  /permissions  Permission rules
  /pr-comments  PR comments (requires gh)
  /issue        Create GitHub issue
  /compact      Compact conversation
  /team         Manage teams

Session:
  /model [name] Change model
  /login        Authenticate
  /logout       Clear credentials
  /status       Auth status
  /config       Settings
  /clear        New conversation
  /exit         Quit`)
      return
    }

    if (trimmed === '/status') {
      const s = authStatusSummary({ bareMode: opts.bare, apiKeyHelper: settings.apiKeyHelper })
      const lines = [`Auth: ${s.ok ? 'active' : 'none'}  kind: ${s.kind}  source: ${s.source}  preference: ${s.preference}`]
      if (s.alsoConfigured?.ignoredHints?.length) {
        for (const h of s.alsoConfigured.ignoredHints) lines.push(`  ${h}`)
      }
      app.addSystemMessage(lines.join('\n'))
      return
    }

    if (trimmed === '/logout') {
      clearSecureCredentials()
      app.addSystemMessage('✓ Credentials cleared.')
      return
    }

    if (trimmed === '/login') {
      if (opts.bare) {
        app.addSystemMessage('Bare mode: only ANTHROPIC_API_KEY / apiKeyHelper allowed (§2.7 A7).')
        return
      }
      app.addSystemMessage('Login: secrets stored in ~/.ona/secure/ (never in SQLite).')
      const kind = await app.askUser('Type (1) API key  (2) Bearer token  (3) Browser OAuth: ')
      if (kind === '1') {
        const key = await app.askUser('ANTHROPIC_API_KEY: ')
        if (!key?.trim()) { app.addSystemMessage('Aborted.'); return }
        saveSecureCredentials({ apiKey: key.trim() }); app.addSystemMessage('Saved API key.')
      } else if (kind === '2') {
        const tok = await app.askUser('Bearer token: ')
        if (!tok?.trim()) { app.addSystemMessage('Aborted.'); return }
        saveSecureCredentials({ bearerToken: tok.trim() }); app.addSystemMessage('Saved bearer token.')
      } else if (kind === '3') {
        try {
          await interactiveOAuthLogin({ println: s => app.addSystemMessage(s) })
        } catch (e) { app.addSystemMessage(`OAuth failed: ${e.message}`) }
      } else { app.addSystemMessage('Invalid choice.') }
      return
    }

    if (trimmed.startsWith('/model')) {
      const arg = trimmed.slice(6).trim()
      if (!arg) {
        let info = ''
        try {
          const wire = resolveWireModel(settings.model_config)
          info = `Provider: ${settings.model_config.provider}\nModel: ${wire}\n\nAvailable:\n`
        } catch (e) { info = `Error: ${e.message}\n\nAvailable:\n` }
        for (const m of allModelIds()) info += `  ${m.provider} / ${m.model_id}\n`
        info += '\nUsage: /model <name>'
        app.addSystemMessage(info)
        return
      }
      const resolved = resolveModelArg(arg)
      if (!resolved) { app.addSystemMessage(`Unknown model: ${arg}`); return }
      settings = updateEffectiveSettings(db, { model_config: resolved })
      try {
        const wire = resolveWireModel(settings.model_config)
        app.addSystemMessage(`✓ Model: ${resolved.provider} / ${wire}`)
      } catch (e) { app.addSystemMessage(`Model set but: ${e.message}`) }
      if (process.env.SDLC_DISABLE_ALL_HOOKS !== '1') {
        await runHooks(db, makeHookRt(), 'ConfigChange', { source: 'user_settings' })
      }
      return
    }

    if (trimmed === '/init') {
      const onaPath = path.join(cwd, 'Ona.md')
      if (fs.existsSync(onaPath)) { app.addSystemMessage('Ona.md already exists.'); return }
      fs.writeFileSync(onaPath, '# Project Instructions\n\nDescribe your project and how ona should work with it.\n\n## Rules\n\n## Context\n', 'utf8')
      app.addSystemMessage(`✓ Created ${onaPath}`)
      return
    }

    if (trimmed === '/cost') {
      const { getSessionTokens } = await import('../lib/orchestrate.mjs')
      const t = getSessionTokens(sessionId)
      const cost = ((t.input * 15 + t.output * 75) / 1_000_000).toFixed(4) // rough opus pricing
      app.addSystemMessage(`Session tokens: ${t.input.toLocaleString()} in / ${t.output.toLocaleString()} out (${t.calls} calls)\nEstimated cost: $${cost}`)
      return
    }

    if (trimmed === '/diff') {
      const { spawnSync } = await import('node:child_process')
      const r = spawnSync('git', ['diff'], { cwd, encoding: 'utf8', timeout: 10_000 })
      app.addSystemMessage(r.stdout?.trim() || '(no uncommitted changes)')
      return
    }

    if (trimmed === '/doctor') {
      const lines = []
      lines.push(`DB: ${dbPath} ✓`)
      try { const w = resolveWireModel(settings.model_config); lines.push(`Model: ${settings.model_config.provider} / ${w} ✓`) }
      catch (e) { lines.push(`Model: ✗ ${e.message}`) }
      const s = authStatusSummary({ bareMode: opts.bare, apiKeyHelper: settings.apiKeyHelper })
      lines.push(`Auth: ${s.ok ? `${s.kind} (${s.source}) ✓` : '✗ not configured'}`)
      lines.push(`Hooks: ${settings.hooks?.length || 0} configured`)
      lines.push(`Ona.md: ${fs.existsSync(path.join(cwd, 'Ona.md')) ? '✓ found' : '✗ not found (run /init)'}`)
      lines.push(`Node: ${process.version}`)
      const { spawnSync: sp } = await import('node:child_process')
      const git = sp('git', ['--version'], { encoding: 'utf8', timeout: 5000 })
      lines.push(`Git: ${git.stdout?.trim() || '✗ not found'}`)
      lines.push(`Phase: ${getPhase(db, conversationId)}`)
      app.addSystemMessage(lines.join('\n'))
      return
    }

    if (trimmed === '/permissions') {
      const p = settings.permissions || {}
      const lines = [`Default mode: ${p.defaultMode || 'default'}`]
      if (p.allow?.length) lines.push(`Allow: ${p.allow.join(', ')}`)
      if (p.deny?.length) lines.push(`Deny: ${p.deny.join(', ')}`)
      if (p.ask?.length) lines.push(`Ask: ${p.ask.join(', ')}`)
      if (!p.allow?.length && !p.deny?.length && !p.ask?.length) lines.push('No custom rules configured.')
      app.addSystemMessage(lines.join('\n'))
      return
    }

    if (trimmed === '/pr-comments') {
      const { spawnSync: sp } = await import('node:child_process')
      // Get current branch and find PR
      const branch = sp('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', timeout: 5000 })
      const branchName = branch.stdout?.trim()
      if (!branchName) { app.addSystemMessage('Not in a git repository.'); return }
      const pr = sp('gh', ['pr', 'view', branchName, '--json', 'number,title,comments', '--jq', '.'], { cwd, encoding: 'utf8', timeout: 15_000 })
      if (pr.status !== 0) { app.addSystemMessage(`No PR found for branch ${branchName}. (Requires gh CLI)`); return }
      try {
        const data = JSON.parse(pr.stdout)
        const lines = [`PR #${data.number}: ${data.title}`]
        for (const c of (data.comments || [])) {
          lines.push(`  ${c.author?.login || 'unknown'}: ${c.body?.slice(0, 200) || ''}`)
        }
        if (!data.comments?.length) lines.push('  No comments.')
        app.addSystemMessage(lines.join('\n'))
      } catch { app.addSystemMessage(pr.stdout?.trim() || 'Failed to parse PR data.') }
      return
    }

    if (trimmed === '/issue') {
      app.addSystemMessage('Create a new issue (SEP format)')
      const title = await app.askUser('Title: ')
      if (!title?.trim()) { app.addSystemMessage('Aborted.'); return }
      const summary = await app.askUser('Summary: ')
      const motivation = await app.askUser('Motivation: ')
      const change = await app.askUser('Proposed change: ')
      const criteria = await app.askUser('Acceptance criteria: ')
      const priority = await app.askUser('Priority (P0/P1/P2): ')
      const size = await app.askUser('Size (XS/S/M/L/XL): ')
      const pLabel = ['P0', 'P1', 'P2'].includes(priority?.trim().toUpperCase()) ? priority.trim().toUpperCase() : 'P2'
      const sLabel = ['XS', 'S', 'M', 'L', 'XL'].includes(size?.trim().toUpperCase()) ? size.trim().toUpperCase() : 'M'
      const body = `## Summary\n${summary || ''}\n\n## Motivation\n${motivation || ''}\n\n## Proposed Change\n${change || ''}\n\n## Acceptance Criteria\n${criteria || ''}`
      const { spawnSync: sp } = await import('node:child_process')
      const labels = `${pLabel},${sLabel},Backlog`
      const r = sp('gh', ['issue', 'create', '--title', title.trim(), '--body', body, '--label', labels], { cwd, encoding: 'utf8', timeout: 30_000 })
      if (r.status === 0) {
        app.addSystemMessage(`✓ Issue created: ${r.stdout.trim()}`)
      } else {
        // Labels might not exist yet — try creating them, then retry
        for (const l of [pLabel, sLabel, 'Backlog']) {
          sp('gh', ['label', 'create', l, '--force'], { cwd, encoding: 'utf8', timeout: 10_000 })
        }
        const r2 = sp('gh', ['issue', 'create', '--title', title.trim(), '--body', body, '--label', labels], { cwd, encoding: 'utf8', timeout: 30_000 })
        if (r2.status === 0) {
          app.addSystemMessage(`✓ Issue created: ${r2.stdout.trim()}`)
        } else {
          app.addSystemMessage(`✗ Failed: ${(r2.stderr || r.stderr || '').trim()}`)
        }
      }
      return
    }

    if (trimmed === '/config' || trimmed === '/settings') {
      app.addSystemMessage(JSON.stringify(settings, null, 2))
      return
    }

    if (trimmed === '/clear' || trimmed === '/reset' || trimmed === '/new') {
      if (process.env.SDLC_DISABLE_ALL_HOOKS !== '1') {
        await runHooks(db, makeHookRt(), 'SessionEnd', { reason: 'clear' })
      }
      conversationId = randomUUID()
      sessionId = randomUUID()
      db.prepare(`INSERT INTO conversations(id, project_dir, phase) VALUES (?,?, 'idle')`).run(conversationId, cwd)
      db.prepare(`INSERT INTO sessions(session_id, conversation_id) VALUES (?,?)`).run(sessionId, conversationId)
      if (process.env.SDLC_DISABLE_ALL_HOOKS !== '1') {
        await runHooks(db, makeHookRt(), 'SessionStart', { source: 'clear', model: (() => { try { return resolveWireModel(settings.model_config) } catch { return '' } })() })
      }
      app.addSystemMessage('✓ Conversation cleared.')
      return
    }

    if (trimmed === '/phase') {
      const phase = getPhase(db, conversationId)
      app.addSystemMessage(`Phase: ${phase}`)
      return
    }

    if (trimmed === '/plan') {
      const plan = db.prepare(`SELECT status, content FROM plans WHERE conversation_id = ? ORDER BY id DESC LIMIT 1`).get(conversationId)
      if (!plan) { app.addSystemMessage('No plan. The model will use EnterPlanMode to start planning.'); return }
      const preview = plan.content.length > 500 ? plan.content.slice(0, 500) + '\n...' : plan.content
      app.addSystemMessage(`Plan status: ${plan.status}\n${preview}`)
      return
    }

    if (trimmed === '/test') {
      const results = db.prepare(`SELECT detail FROM events WHERE conversation_id = ? AND event_type = 'test_result' ORDER BY id`).all(conversationId)
      if (!results.length) { app.addSystemMessage('No test results yet. Tests run automatically when the model calls SubmitImplementation and you approve.'); return }
      const passed = results.filter(r => JSON.parse(r.detail).passed).length
      app.addSystemMessage(`Test results: ${passed}/${results.length} passed`)
      for (const r of results) { const d = JSON.parse(r.detail); app.addSystemMessage(`  ${d.passed ? '✓' : '✗'} ${d.criterion}`) }
      return
    }

    if (trimmed === '/verify') {
      const results = db.prepare(`SELECT detail FROM events WHERE conversation_id = ? AND event_type = 'test_result' ORDER BY id`).all(conversationId)
      if (!results.length) { app.addSystemMessage('No coverage data. Tests run automatically on implementation approval.'); return }
      app.addSystemMessage('Coverage Report:')
      for (const r of results) { const d = JSON.parse(r.detail); app.addSystemMessage(`  ${d.passed ? '✓' : '✗'} ${d.criterion}`) }
      const passed = results.filter(r => JSON.parse(r.detail).passed).length
      app.addSystemMessage(`Aggregate: ${passed}/${results.length} passed`)
      return
    }

    if (trimmed === '/code') {
      const phase = getPhase(db, conversationId)
      if (phase === 'implement') app.addSystemMessage('Implementation in progress. The model will call SubmitImplementation when ready for review.')
      else app.addSystemMessage(`Phase: ${phase}. Implementation happens automatically after plan approval.`)
      return
    }

    if (trimmed === '/compact') {
      settings = getEffectiveSettings(db)
      const rt = { sessionId, conversationId, runtimeDbPath: dbPath, cwd, bareMode: opts.bare, settings }
      const summary = await compactConversation(db, rt, async (text) => {
        // Use model to summarize
        const { runUserTurn: turn } = await import('../lib/orchestrate.mjs')
        // Simple summarization — send text to model and capture response
        return `[Conversation compacted: ${text.split('\n').length} messages summarized]`
      }, s => app.addSystemMessage(s))
      if (summary) app.addSystemMessage(`Summary:\n${summary}`)
      return
    }

    if (trimmed.startsWith('/team')) {
      const arg = trimmed.slice(5).trim()
      if (arg.startsWith('create ')) {
        const name = arg.slice(7).trim()
        if (!name) { app.addSystemMessage('Usage: /team create <name>'); return }
        createTeam(name, sessionId)
        app.addSystemMessage(`✓ Team created: ${name}`)
      } else if (arg === 'list') {
        const teams = listTeams()
        if (!teams.length) { app.addSystemMessage('No teams.'); return }
        for (const t of teams) {
          const members = t.members?.map(m => `${m.name}${m.isActive ? '' : ' (idle)'}`).join(', ') || 'none'
          app.addSystemMessage(`${t.name}: ${members}`)
        }
      } else if (arg.startsWith('delete ')) {
        const name = arg.slice(7).trim()
        deleteTeam(name)
        app.addSystemMessage(`✓ Team deleted: ${name}`)
      } else {
        app.addSystemMessage('Usage: /team create <name> | /team list | /team delete <name>')
      }
      return
    }

    if (trimmed === '/issue') {
      app.addSystemMessage('Create a new issue (SEP format)')
      const title = await app.askUser('Title: ')
      if (!title?.trim()) { app.addSystemMessage('Aborted.'); return }
      const summary = await app.askUser('Summary: ')
      const motivation = await app.askUser('Motivation: ')
      const change = await app.askUser('Proposed change: ')
      const criteria = await app.askUser('Acceptance criteria: ')
      const priority = await app.askUser('Priority (P0/P1/P2): ')
      const size = await app.askUser('Size (XS/S/M/L/XL): ')
      const pLabel = ['P0', 'P1', 'P2'].includes(priority?.trim().toUpperCase()) ? priority.trim().toUpperCase() : 'P2'
      const sLabel = ['XS', 'S', 'M', 'L', 'XL'].includes(size?.trim().toUpperCase()) ? size.trim().toUpperCase() : 'M'
      const body = `## Summary\n${summary || ''}\n\n## Motivation\n${motivation || ''}\n\n## Proposed Change\n${change || ''}\n\n## Acceptance Criteria\n${criteria || ''}`
      const { spawnSync: sp } = await import('node:child_process')
      const labels = `${pLabel},${sLabel},Backlog`
      for (const l of [pLabel, sLabel, 'Backlog']) {
        sp('gh', ['label', 'create', l, '--force'], { cwd, encoding: 'utf8', timeout: 10_000 })
      }
      const r = sp('gh', ['issue', 'create', '--title', title.trim(), '--body', body, '--label', labels], { cwd, encoding: 'utf8', timeout: 30_000 })
      if (r.status === 0) {
        app.addSystemMessage(`✓ Issue created: ${r.stdout.trim()}`)
      } else {
        app.addSystemMessage(`✗ Failed: ${(r.stderr || '').trim()}`)
      }
      return
    }

    if (trimmed === '/done') {
      const phase = getPhase(db, conversationId)
      app.addSystemMessage(`Phase: ${phase}. Workflow completes automatically when all tests pass and you approve the coverage report.`)
      return
    }

    if (trimmed.startsWith('/')) {
      app.addSystemMessage(`Unknown command: ${trimmed}. Type /help for commands.`)
      return
    }

    // User turn
    settings = getEffectiveSettings(db)
    app.startLoading()
    const rt = {
      sessionId, conversationId, runtimeDbPath: dbPath, cwd,
      bareMode: opts.bare, settings, onaInstructions,
    }
    let streamBuf = ''
    const io = {
      write: s => {
        app.stopLoading()
        streamBuf += s
        app.updateStream(streamBuf)
      },
      println: s => {
        app.stopLoading()
        if (s) app.addSystemMessage(String(s))
      },
      ask: async (q) => {
        app.stopLoading()
        return app.askUser(String(q || ''))
      },
      spinner: { start: () => {}, stop: () => {} },
      // Structured tool events for Ink UI
      onToolStart: (name) => { app.addToolStart(name) },
      onToolResult: (name, content, isError) => { app.addToolResult(name, content, isError) },
    }
    await runUserTurn(db, rt, line, io)
    app.stopLoading()
    if (streamBuf) {
      app.clearStream()
      app.addAssistantMessage(streamBuf)
      streamBuf = ''
    }
  }

  async function shutdown() {
    if (process.env.SDLC_DISABLE_ALL_HOOKS !== '1') {
      await runHooks(db, makeHookRt(), 'SessionEnd', { reason: 'prompt_input_exit' })
    }
    closeAllMcpServers()
    app.instance?.unmount()
    process.exit(0)
  }
}

// ── Pipe mode (non-TTY) — readline for acceptance tests ──────
async function mainPipe(opts) {
  const ctx = bootstrap(opts)
  let { db, dbPath, settings, pkg, conversationId, sessionId, cwd } = ctx

  const makeHookRt = () => ({
    sessionId, conversationId, runtimeDbPath: dbPath, cwd,
    permissionMode: settings.permissions?.defaultMode ?? 'default', settings,
  })

  if (process.env.SDLC_DISABLE_ALL_HOOKS !== '1') {
    await runHooks(db, makeHookRt(), 'SessionStart', { source: 'startup', model: (() => { try { return resolveWireModel(settings.model_config) } catch { return '' } })() })
  }

  // Import UI for pipe-mode formatting (legacy)
  const ui = await import('../lib/ui.mjs')

  const rl = readline.createInterface({ input, output })
  const io = {
    write: s => output.write(s),
    println: s => console.log(s),
    ask: async (q) => { if (!process.stdin.isTTY) return 'y'; return rl.question(q) },
    spinner: { start: () => {}, stop: () => {} },
  }

  // Pipe-mode banner
  const provider = settings.model_config?.provider || 'lm_studio_local'
  let wireModel = '(not set)'
  try { wireModel = resolveWireModel(settings.model_config) } catch {}
  output.write(ui.printBanner(pkg.version, dbPath, opts.bare))
  const base = (process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1').replace(/\/$/, '')
  const endpoint = provider === 'lm_studio_local' ? `${base}/chat/completions`
    : provider === 'openai_compatible' ? `${process.env.OPENAI_BASE_URL || '(unset)'}/chat/completions`
    : `${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`
  output.write(ui.printProviderBanner(provider, wireModel, endpoint))
  output.write(ui.colors.dim('  Type /help for commands\n\n'))

  while (true) {
    let line
    try { line = (await rl.question(ui.formatPrompt())).trim() } catch (e) {
      if (e?.code === 'ERR_USE_AFTER_CLOSE') break; throw e
    }
    if (!line) continue
    if (line === '/exit' || line === '/quit') break

    if (line === '/help') {
      io.println(ui.formatHelp(provider, dbPath)); continue
    }
    if (line === '/status') {
      const s = authStatusSummary({ bareMode: opts.bare, apiKeyHelper: settings.apiKeyHelper })
      io.println(ui.formatStatus(s)); continue
    }
    if (line === '/logout') {
      clearSecureCredentials(); io.println(ui.colors.success('  ✓ Credentials cleared.')); continue
    }
    if (line === '/login') {
      await interactiveLogin(rl, io, opts.bare); settings = getEffectiveSettings(db); continue
    }
    if (line.startsWith('/model')) {
      const arg = line.slice(6).trim()
      if (!arg) {
        try {
          const wire = resolveWireModel(settings.model_config)
          io.println(`\n  ${ui.colors.key('Provider:')} ${ui.colors.provider(settings.model_config.provider)}`)
          io.println(`  ${ui.colors.key('Model:')}    ${ui.colors.model(wire)}`)
        } catch (e) { io.println(`  ${ui.colors.error(e.message)}`) }
        io.println(`\n${ui.colors.header('Available models')}`)
        for (const m of allModelIds()) io.println(`  ${ui.colors.provider(m.provider)} ${ui.colors.dim('/')} ${ui.colors.model(m.model_id)}`)
        io.println(`\n  ${ui.colors.dim('Usage: /model <name>')}\n`)
        continue
      }
      const resolved = resolveModelArg(arg)
      if (!resolved) { io.println(ui.colors.error(`  Unknown model: ${arg}.`)); continue }
      settings = updateEffectiveSettings(db, { model_config: resolved })
      try { const wire = resolveWireModel(settings.model_config); io.println(ui.formatModelChange(resolved.provider, resolved.model_id, wire)) }
      catch (e) { io.println(`  ${ui.colors.warning('Model set but: ' + e.message)}`) }
      continue
    }
    if (line === '/config' || line === '/settings') {
      io.println(ui.formatConfig(settings)); continue
    }
    if (line === '/clear' || line === '/reset' || line === '/new') {
      if (process.env.SDLC_DISABLE_ALL_HOOKS !== '1') await runHooks(db, makeHookRt(), 'SessionEnd', { reason: 'clear' })
      conversationId = randomUUID(); sessionId = randomUUID()
      db.prepare(`INSERT INTO conversations(id, project_dir, phase) VALUES (?,?, 'idle')`).run(conversationId, cwd)
      db.prepare(`INSERT INTO sessions(session_id, conversation_id) VALUES (?,?)`).run(sessionId, conversationId)
      if (process.env.SDLC_DISABLE_ALL_HOOKS !== '1') await runHooks(db, makeHookRt(), 'SessionStart', { source: 'clear', model: (() => { try { return resolveWireModel(settings.model_config) } catch { return '' } })() })
      io.println(ui.colors.success('  ✓ Conversation cleared.')); continue
    }
    if (line === '/phase') {
      io.println(`  Phase: ${getPhase(db, conversationId)}`); continue
    }
    if (line === '/plan') {
      const plan = db.prepare(`SELECT status, content FROM plans WHERE conversation_id = ? ORDER BY id DESC LIMIT 1`).get(conversationId)
      if (!plan) { io.println('  No plan.'); continue }
      io.println(`  Plan: ${plan.status}\n${plan.content.slice(0, 500)}`); continue
    }
    if (line === '/code') {
      const phase = getPhase(db, conversationId)
      if (phase !== 'implement') { io.println(`  Cannot /code in phase: ${phase}`); continue }
      const plan = db.prepare(`SELECT content FROM plans WHERE conversation_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1`).get(conversationId)
      if (!plan) { io.println('  No approved plan.'); continue }
      io.println('  Implementing...')
      settings = getEffectiveSettings(db)
      const crt = { sessionId, conversationId, runtimeDbPath: dbPath, cwd, bareMode: opts.bare, settings, onaInstructions: onaInstructions?.content }
      await runUserTurn(db, crt, `Implement the following approved plan:\n\n${plan.content}`, io)
      continue
    }
    if (line === '/test') {
      const phase = getPhase(db, conversationId)
      if (phase !== 'implement' && phase !== 'test') { io.println(`  Cannot test in phase: ${phase}`); continue }
      const plan = db.prepare(`SELECT content FROM plans WHERE conversation_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1`).get(conversationId)
      if (!plan) { io.println('  No approved plan.'); continue }
      const { generateAndRunTests } = await import('../lib/testgen.mjs')
      settings = getEffectiveSettings(db)
      const trt = { sessionId, conversationId, runtimeDbPath: dbPath, cwd, bareMode: opts.bare, settings }
      const results = await generateAndRunTests(db, trt, plan.content, s => io.println(`  ${s}`))
      if (phase === 'implement') setPhase(db, conversationId, 'test')
      const passed = results.filter(r => r.passed).length
      io.println(`  Tests: ${passed}/${results.length} passed`)
      continue
    }
    if (line === '/verify') {
      if (getPhase(db, conversationId) !== 'test') { io.println('  Must be in test phase.'); continue }
      const results = db.prepare(`SELECT detail FROM events WHERE conversation_id = ? AND event_type = 'test_result' ORDER BY id`).all(conversationId)
      if (!results.length) { io.println('  No test results. Run /test.'); continue }
      for (const r of results) { const d = JSON.parse(r.detail); io.println(`  ${d.passed ? '✓' : '✗'} ${d.criterion}`) }
      continue
    }
    if (line === '/issue') {
      io.println('  /issue requires interactive mode (run ona in TTY).'); continue
    }
    if (line === '/done') {
      if (getPhase(db, conversationId) !== 'verify') { io.println('  Must be in verify phase.'); continue }
      setPhase(db, conversationId, 'done')
      const { spawnSync: sp } = await import('node:child_process')
      const plan = db.prepare(`SELECT content FROM plans WHERE conversation_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1`).get(conversationId)
      const planTitle = plan?.content?.split('\n').find(l => l.startsWith('#'))?.replace(/^#+\s*/, '') || 'SDLC workflow complete'
      sp('git', ['add', '-A'], { cwd, encoding: 'utf8' })
      const commit = sp('git', ['commit', '-m', `${planTitle}\n\nPlan approved and verified via ona SDLC workflow.`], { cwd, encoding: 'utf8', timeout: 30_000 })
      const hash = commit.status === 0 ? sp('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' }).stdout?.trim() : null
      io.println(hash ? `  Phase: done ✓ Committed: ${hash}` : `  Phase: done ✓ (commit failed)`); continue
    }
    if (line === '/compact') {
      settings = getEffectiveSettings(db)
      const crt = { sessionId, conversationId, runtimeDbPath: dbPath, cwd, bareMode: opts.bare, settings }
      await compactConversation(db, crt, async (text) => `[Compacted: ${text.split('\n').length} messages]`, s => io.println(`  ${s}`))
      continue
    }
    if (line === '/init') {
      const onaPath = path.join(cwd, 'Ona.md')
      if (fs.existsSync(onaPath)) { io.println('  Ona.md already exists.'); continue }
      fs.writeFileSync(onaPath, '# Project Instructions\n\nDescribe your project and how ona should work with it.\n\n## Rules\n\n## Context\n', 'utf8')
      io.println(`  ✓ Created ${onaPath}`); continue
    }
    if (line === '/cost') {
      const { getSessionTokens } = await import('../lib/orchestrate.mjs')
      const t = getSessionTokens(sessionId)
      const cost = ((t.input * 15 + t.output * 75) / 1_000_000).toFixed(4)
      io.println(`  Tokens: ${t.input.toLocaleString()} in / ${t.output.toLocaleString()} out (${t.calls} calls) ≈ $${cost}`); continue
    }
    if (line === '/diff') {
      const { spawnSync: sp } = await import('node:child_process')
      const r = sp('git', ['diff'], { cwd, encoding: 'utf8', timeout: 10_000 })
      io.println(r.stdout?.trim() || '  (no changes)'); continue
    }
    if (line === '/doctor') {
      io.println(`  DB: ${dbPath} ✓`)
      try { const w = resolveWireModel(settings.model_config); io.println(`  Model: ${settings.model_config.provider} / ${w} ✓`) }
      catch (e) { io.println(`  Model: ✗ ${e.message}`) }
      const s = authStatusSummary({ bareMode: opts.bare, apiKeyHelper: settings.apiKeyHelper })
      io.println(`  Auth: ${s.ok ? s.kind + ' ✓' : '✗ not configured'}`)
      io.println(`  Hooks: ${settings.hooks?.length || 0}`)
      io.println(`  Ona.md: ${fs.existsSync(path.join(cwd, 'Ona.md')) ? '✓' : '✗ (run /init)'}`)
      io.println(`  Phase: ${getPhase(db, conversationId)}`); continue
    }
    if (line === '/permissions') {
      const p = settings.permissions || {}
      io.println(`  Default mode: ${p.defaultMode || 'default'}`)
      if (p.allow?.length) io.println(`  Allow: ${p.allow.join(', ')}`)
      if (p.deny?.length) io.println(`  Deny: ${p.deny.join(', ')}`)
      if (p.ask?.length) io.println(`  Ask: ${p.ask.join(', ')}`)
      continue
    }
    if (line === '/pr-comments') {
      const { spawnSync: sp } = await import('node:child_process')
      const branch = sp('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', timeout: 5000 })
      const branchName = branch.stdout?.trim()
      if (!branchName) { io.println('  Not in a git repo.'); continue }
      const pr = sp('gh', ['pr', 'view', branchName, '--json', 'number,title,comments'], { cwd, encoding: 'utf8', timeout: 15_000 })
      if (pr.status !== 0) { io.println(`  No PR for ${branchName}. (Requires gh)`); continue }
      io.println(pr.stdout?.trim() || '  No data.'); continue
    }
    if (line.startsWith('/team')) {
      const arg = line.slice(5).trim()
      if (arg.startsWith('create ')) { createTeam(arg.slice(7).trim(), sessionId); io.println('  ✓ Team created.') }
      else if (arg === 'list') { for (const t of listTeams()) io.println(`  ${t.name}: ${t.members?.map(m => m.name).join(', ') || 'none'}`) }
      else if (arg.startsWith('delete ')) { deleteTeam(arg.slice(7).trim()); io.println('  ✓ Deleted.') }
      else io.println('  Usage: /team create|list|delete <name>')
      continue
    }
    if (line.startsWith('/')) { io.println(`Unknown command: ${line}. Type /help.`); continue }

    settings = getEffectiveSettings(db)
    const onaInst = loadInstructions(cwd)
    const rt = { sessionId, conversationId, runtimeDbPath: dbPath, cwd, bareMode: opts.bare, settings, onaInstructions: onaInst.content }
    await runUserTurn(db, rt, line, io)
    io.println('')
  }

  if (process.env.SDLC_DISABLE_ALL_HOOKS !== '1') await runHooks(db, makeHookRt(), 'SessionEnd', { reason: 'prompt_input_exit' })
  closeAllMcpServers()
  rl.close()
}

async function interactiveLogin(rl, io, bareMode) {
  if (bareMode) { io.println('Bare mode: only ANTHROPIC_API_KEY / apiKeyHelper allowed (§2.7 A7).'); return }
  io.println('Login: secrets stored in ~/.ona/secure/ (never in SQLite).')
  const kind = (await rl.question('Type (1) API key  (2) Bearer token  (3) Browser OAuth: ')).trim()
  if (kind === '1') {
    const key = (await rl.question('ANTHROPIC_API_KEY: ')).trim()
    if (!key) { io.println('Aborted.'); return }
    saveSecureCredentials({ apiKey: key }); io.println('Saved API key.')
  } else if (kind === '2') {
    const tok = (await rl.question('Bearer token: ')).trim()
    if (!tok) { io.println('Aborted.'); return }
    saveSecureCredentials({ bearerToken: tok }); io.println('Saved bearer token.')
  } else if (kind === '3') {
    try { await interactiveOAuthLogin(io) } catch (e) { io.println(`OAuth failed: ${e.message}`) }
  } else { io.println('Invalid choice.') }
}

function resolveModelArg(arg) {
  const all = allModelIds()
  if (arg.includes('/')) {
    const [p, m] = arg.split('/', 2)
    const match = all.find(x => x.provider === p && x.model_id === m)
    if (match) return match
  }
  const match = all.find(x => x.model_id === arg)
  if (match) return match
  // Freeform name → LM Studio; set env var (§2.2 forbids extra model_config keys)
  process.env.LM_STUDIO_MODEL = arg
  return { provider: 'lm_studio_local', model_id: 'lm_studio_server_routed' }
}

// ── CLI: --eval ──────────────────────────────────────────────
async function runEval(opts) {
  const ctx = bootstrap(opts)
  let parsed
  try { parsed = JSON.parse(opts.eval) } catch (e) { console.error(`Invalid JSON: ${e.message}`); process.exit(1) }
  const toolName = parsed.tool
  const toolInput = parsed.input || {}
  if (!toolName) { console.error('Missing "tool" in eval JSON'); process.exit(1) }
  const io = { write: s => process.stdout.write(s), println: s => console.log(s), ask: async () => 'y' }
  const execCtx = { sessionId: ctx.sessionId, conversationId: ctx.conversationId, cwd: ctx.cwd, settings: ctx.settings }
  const result = await executeBuiltinTool(ctx.db, execCtx, toolName, toolInput, io)
  appendEntry(ctx.db, ctx.sessionId, 'tool_result', makeToolResultPayload(randomUUID(), result.content, result.is_error), null)
  console.log(JSON.stringify(result))
  process.exit(result.is_error ? 1 : 0)
}

// ── CLI: --transition ────────────────────────────────────────
function runTransition(opts) {
  const ctx = bootstrap(opts)
  const convId = opts.conversation || ctx.conversationId
  const toPhase = opts.transition
  const check = canTransition(ctx.db, convId, toPhase)
  if (!check.ok) { console.error(check.reason); process.exit(1) }
  setPhase(ctx.db, convId, toPhase)
  console.log(`Phase: ${toPhase}`)
  process.exit(0)
}

// ── Entry point ──────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv)
  if (opts.help) {
    console.log(`ona — SDLC SQLite REPL (CLEAN_ROOM_SPEC; multi-provider)
Usage: ona [--bare] [--cwd DIR] [--eval JSON] [--transition PHASE] [--init-db]

Flags:
  --eval '{"tool":"...","input":{...}}'   Execute a single tool and exit
  --transition <phase> --conversation <id> Transition phase and exit
  --init-db                                Initialize DB and exit

Environment:
  AGENT_SDLC_DB             SQLite path (default: ~/.ona/agent.db)
  ANTHROPIC_API_KEY          API key for claude_code_subscription
  ANTHROPIC_AUTH_TOKEN       Bearer token
  SDLC_DISABLE_ALL_HOOKS=1  Skip hooks

Commands: /help /phase /plan /test /verify /done /model /login /logout /status /config /clear /exit`)
    return
  }

  // CLI flag dispatch — no model/TTY needed
  if (opts.initDb) { bootstrap(opts); console.log(`DB: ${process.env.AGENT_SDLC_DB}`); return }
  if (opts.eval) { await runEval(opts); return }
  if (opts.transition) { runTransition(opts); return }

  await autoDetectLmStudioModel()

  if (process.stdin.isTTY) {
    await mainInteractive(opts)
  } else {
    await mainPipe(opts)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
