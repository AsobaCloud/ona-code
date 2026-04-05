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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(__dirname, '..')

function parseArgs(argv) {
  const args = { bare: false, cwd: process.cwd(), help: false }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') args.help = true
    else if (argv[i] === '--bare') args.bare = true
    else if (argv[i] === '--cwd' && argv[i + 1]) args.cwd = path.resolve(argv[++i])
  }
  return args
}

// ── Shared bootstrap ─────────────────────────────────────────
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

  if (process.env.SDLC_DISABLE_ALL_HOOKS !== '1') {
    await runHooks(db, makeHookRt(), 'SessionStart', { source: 'startup', model: settings.model_config?.model_id ?? '' })
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
    bare: opts.bare,
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
      app.addSystemMessage(`Commands:
  /help         Show available commands
  /model [name] Show or change active model
  /login        Authenticate with provider
  /logout       Clear stored credentials
  /status       Show credential status
  /config       Show current settings
  /clear        Clear conversation (/reset, /new)
  /exit         Quit (/quit)`)
      return
    }

    if (trimmed === '/status') {
      const s = authStatusSummary({ bareMode: opts.bare, apiKeyHelper: settings.apiKeyHelper })
      app.addSystemMessage(JSON.stringify(s, null, 2))
      return
    }

    if (trimmed === '/logout') {
      clearSecureCredentials()
      app.addSystemMessage('✓ Credentials cleared.')
      return
    }

    if (trimmed === '/login') {
      app.addSystemMessage('Login: set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN in environment. Interactive OAuth requires TTY input.')
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
        await runHooks(db, makeHookRt(), 'SessionStart', { source: 'clear', model: settings.model_config?.model_id ?? '' })
      }
      app.addSystemMessage('✓ Conversation cleared.')
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
      bareMode: opts.bare, settings,
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
      },
      ask: async (q) => 'y',
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
    await runHooks(db, makeHookRt(), 'SessionStart', { source: 'startup', model: settings.model_config?.model_id ?? '' })
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
      if (process.env.SDLC_DISABLE_ALL_HOOKS !== '1') await runHooks(db, makeHookRt(), 'SessionStart', { source: 'clear', model: settings.model_config?.model_id ?? '' })
      io.println(ui.colors.success('  ✓ Conversation cleared.')); continue
    }
    if (line.startsWith('/')) { io.println(`Unknown command: ${line}. Type /help.`); continue }

    settings = getEffectiveSettings(db)
    const rt = { sessionId, conversationId, runtimeDbPath: dbPath, cwd, bareMode: opts.bare, settings }
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
  return { provider: 'lm_studio_local', model_id: 'lm_studio_server_routed', lm_studio_model: arg }
}

// ── Entry point ──────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv)
  if (opts.help) {
    console.log(`ona — SDLC SQLite REPL (CLEAN_ROOM_SPEC; multi-provider)
Usage: ona [--bare] [--cwd DIR]

Environment:
  AGENT_SDLC_DB             SQLite path (default: ~/.ona/agent.db)
  ANTHROPIC_API_KEY          API key for claude_code_subscription
  ANTHROPIC_AUTH_TOKEN       Bearer token
  SDLC_DISABLE_ALL_HOOKS=1  Skip hooks

Commands: /help /model /login /logout /status /config /clear /exit`)
    return
  }

  if (process.stdin.isTTY) {
    await mainInteractive(opts)
  } else {
    await mainPipe(opts)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
