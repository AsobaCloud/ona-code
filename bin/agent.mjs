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

async function main() {
  const opts = parseArgs(process.argv)
  if (opts.help) {
    console.log(`ona — SDLC SQLite REPL (CLEAN_ROOM_SPEC; multi-provider)
Usage: ona [--bare] [--cwd DIR]

Environment:
  AGENT_SDLC_DB             SQLite path (default: ~/.ona/agent.db)
  ANTHROPIC_API_KEY          API key for claude_code_subscription (§2.7 A1)
  ANTHROPIC_AUTH_TOKEN       Bearer token (§2.7 A2)
  CLAUDE_CODE_OAUTH_TOKEN    Managed-launcher token (§2.8)
  ONA_AUTH_PREFERENCE        auto | subscription | api_key
  SDLC_DISABLE_ALL_HOOKS=1  Skip hooks (§5.10)

LM Studio (provider: lm_studio_local):
  LM_STUDIO_BASE_URL    default http://127.0.0.1:1234/v1
  LM_STUDIO_API_KEY     default lm-studio
  LM_STUDIO_MODEL       required if model_id is lm_studio_server_routed

openai_compatible:
  OPENAI_BASE_URL + OPENAI_API_KEY (§2.3)

Commands: /help /model /login /logout /status /config /clear /exit`)
    return
  }

  const cwd = opts.cwd
  process.chdir(cwd)

  let dbPath = process.env.AGENT_SDLC_DB
  if (dbPath && !path.isAbsolute(dbPath)) dbPath = path.resolve(cwd, dbPath)
  if (!dbPath) dbPath = defaultDbPath()
  process.env.AGENT_SDLC_DB = dbPath

  const db = openStore(dbPath)
  let settings = bootstrapSettings(db, cwd)

  const provider = settings.model_config?.provider || 'claude_code_subscription'
  if (provider === 'lm_studio_local' && settings.model_config?.model_id === 'lm_studio_server_routed') {
    if (!process.env.LM_STUDIO_MODEL?.trim()) {
      console.error('ona: LM_STUDIO_MODEL is required when model_config.model_id is lm_studio_server_routed.')
      process.exit(1)
    }
  }

  let conversationId = randomUUID()
  let sessionId = randomUUID()
  db.prepare(`INSERT INTO conversations(id, project_dir, phase) VALUES (?,?, 'idle')`).run(conversationId, cwd)
  db.prepare(`INSERT INTO sessions(session_id, conversation_id) VALUES (?,?)`).run(sessionId, conversationId)

  const makeRt = () => ({
    sessionId, conversationId, runtimeDbPath: dbPath, cwd,
    bareMode: opts.bare, settings,
  })

  const makeHookRt = () => ({
    sessionId, conversationId, runtimeDbPath: dbPath, cwd,
    permissionMode: settings.permissions?.defaultMode ?? 'default', settings,
  })

  if (process.env.SDLC_DISABLE_ALL_HOOKS !== '1') {
    await runHooks(db, makeHookRt(), 'SessionStart', { source: 'startup', model: settings.model_config?.model_id ?? '' })
  }

  const rl = readline.createInterface({ input, output })
  const io = {
    write: s => output.write(s),
    println: s => console.log(s),
    ask: q => rl.question(q),
  }

  printBanner(dbPath, opts.bare)
  printProviderInfo(settings, io, opts.bare)
  io.println('Commands: /help /model /login /logout /status /config /clear /exit\n')

  while (true) {
    let line
    try { line = (await rl.question('ona> ')).trim() } catch (e) {
      if (e?.code === 'ERR_USE_AFTER_CLOSE') break; throw e
    }
    if (!line) continue

    // ── Slash commands ──────────────────────────────────
    if (line === '/exit' || line === '/quit') break

    if (line === '/help') {
      io.println(`ona — SDLC SQLite REPL (CLEAN_ROOM_SPEC)
  /help              Show this help
  /model [id]        Show or change active model (immediate, no restart)
  /login             Store credentials (API key, bearer, or OAuth)
  /logout            Clear secure credentials
  /status            Show credential status (no secrets printed)
  /config            Show/edit current settings
  /settings          Alias for /config
  /clear             Clear conversation (aliases: /reset, /new)
  /exit              Quit (alias: /quit)

Provider: ${settings.model_config?.provider || 'claude_code_subscription'}
DB: ${dbPath}`)
      continue
    }

    if (line === '/status') {
      const s = authStatusSummary({ bareMode: opts.bare, apiKeyHelper: settings.apiKeyHelper })
      io.println(JSON.stringify(s, null, 2))
      continue
    }

    if (line === '/logout') {
      clearSecureCredentials()
      io.println('Secure file cleared.')
      continue
    }

    if (line === '/login') {
      await interactiveLogin(rl, io, opts.bare)
      settings = getEffectiveSettings(db)
      continue
    }

    if (line.startsWith('/model')) {
      const arg = line.slice(6).trim()
      if (!arg) {
        try {
          const wire = resolveWireModel(settings.model_config)
          io.println(`Current: provider=${settings.model_config.provider} model_id=${settings.model_config.model_id} wire=${wire}`)
        } catch (e) { io.println(`Current: ${e.message}`) }
        io.println('Available:')
        for (const m of allModelIds()) {
          io.println(`  ${m.provider} / ${m.model_id}`)
        }
        io.println('Usage: /model <model_id> or /model <provider>/<model_id>')
        continue
      }
      const resolved = resolveModelArg(arg)
      if (!resolved) { io.println(`Unknown model: ${arg}. Use /model to list available.`); continue }
      settings = updateEffectiveSettings(db, { model_config: resolved })
      try {
        const wire = resolveWireModel(settings.model_config)
        io.println(`Model changed: ${resolved.provider}/${resolved.model_id} (wire: ${wire})`)
      } catch (e) { io.println(`Model set but wire resolution: ${e.message}`) }
      continue
    }

    if (line === '/config' || line === '/settings') {
      io.println('Current settings:')
      io.println(JSON.stringify(settings, null, 2))
      io.println('\nUse /model to change model. Edit .ona/settings.json for other changes.')
      continue
    }

    if (line === '/clear' || line === '/reset' || line === '/new') {
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
      io.println('Conversation cleared.')
      continue
    }

    if (line.startsWith('/')) {
      io.println(`Unknown command: ${line}. Type /help for available commands.`)
      continue
    }

    // ── User turn ───────────────────────────────────────
    settings = getEffectiveSettings(db)
    const rt = makeRt()
    await runUserTurn(db, rt, line, io)
    io.println('')
  }

  if (process.env.SDLC_DISABLE_ALL_HOOKS !== '1') {
    await runHooks(db, makeHookRt(), 'SessionEnd', { reason: 'prompt_input_exit' })
  }
  closeAllMcpServers()
  rl.close()
}

function printBanner(dbPath, bare) {
  const v = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'))
  console.log(`ona ${v.version} — AGENT_SDLC_DB=${dbPath}${bare ? ' [bare]' : ''}`)
}

function printProviderInfo(settings, io, bare) {
  const provider = settings.model_config?.provider || 'claude_code_subscription'
  if (provider === 'lm_studio_local') {
    try {
      const wire = resolveWireModel(settings.model_config)
      const base = (process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1').replace(/\/$/, '')
      io.println(`Provider: lm_studio_local  model: ${wire}`)
      io.println(`Endpoint: ${base}/chat/completions`)
    } catch (e) { io.println(`[config] ${e.message}`) }
    io.println('LM Studio: load model, start server. No Anthropic credentials needed.')
  } else if (provider === 'openai_compatible') {
    io.println(`Provider: openai_compatible  base: ${process.env.OPENAI_BASE_URL || '(unset)'}`)
  } else {
    const st = authStatusSummary({ bareMode: bare, apiKeyHelper: settings.apiKeyHelper })
    io.println(st.ok ? `Auth: ${st.kind} via ${st.source}` : 'Auth: none — set ANTHROPIC_API_KEY or run /login')
  }
}

async function interactiveLogin(rl, io, bareMode) {
  if (bareMode) { io.println('Bare mode: only ANTHROPIC_API_KEY / apiKeyHelper allowed (§2.7 A7).'); return }
  io.println('Login: secrets stored in ~/.ona/secure/ (never in SQLite).')
  const kind = (await rl.question('Type (1) API key  (2) Bearer token  (3) Browser OAuth: ')).trim()
  if (kind === '1') {
    const key = (await rl.question('ANTHROPIC_API_KEY: ')).trim()
    if (!key) { io.println('Aborted.'); return }
    saveSecureCredentials({ apiKey: key })
    io.println('Saved API key to secure file.')
  } else if (kind === '2') {
    const tok = (await rl.question('Bearer token: ')).trim()
    if (!tok) { io.println('Aborted.'); return }
    saveSecureCredentials({ bearerToken: tok })
    io.println('Saved bearer token to secure file.')
  } else if (kind === '3') {
    try { await interactiveOAuthLogin(io) } catch (e) { io.println(`OAuth failed: ${e.message}`) }
  } else {
    io.println('Invalid choice.')
  }
}

function resolveModelArg(arg) {
  const all = allModelIds()
  // Try provider/model_id format
  if (arg.includes('/')) {
    const [p, m] = arg.split('/', 2)
    const match = all.find(x => x.provider === p && x.model_id === m)
    if (match) return match
  }
  // Try model_id alone
  const match = all.find(x => x.model_id === arg)
  if (match) return match
  // Try partial match
  const partial = all.find(x => x.model_id.includes(arg) || x.provider.includes(arg))
  return partial || null
}

main().catch(e => { console.error(e); process.exit(1) })
