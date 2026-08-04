#!/usr/bin/env node
// nehanda-ui — Ink terminal UI for ona-code
// Connects directly to nehanda-ml.asoba.co via the in-process ona-code engine.
// No aimee-server, no HTTP daemon, no cross-repo resolution.

if (process.stdout.isTTY) {
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H')
}

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

// ── In-process engine imports (direct, single-repo) ──────────
import { runUserTurn } from '../lib/orchestrate.mjs'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT  = path.resolve(__dirname, '..')

// All remaining UI deps live in ona-code's own node_modules
const { default: React }          = await import(`${REPO_ROOT}/node_modules/react/index.js`)
const { render, Box, Text, useApp, useInput, Static }
                                  = await import(`${REPO_ROOT}/node_modules/ink/build/index.js`)
const { default: TextInput }      = await import(`${REPO_ROOT}/node_modules/ink-text-input/build/index.js`)
const { default: chalk }          = await import(`${REPO_ROOT}/node_modules/chalk/source/index.js`)
const { marked }                  = await import(`${REPO_ROOT}/node_modules/marked/lib/marked.esm.js`)
const { default: TerminalRenderer }= await import(`${REPO_ROOT}/node_modules/marked-terminal/index.js`)

const e = React.createElement

// ── Asoba 3 Visual Identity ───────────────────────────────────
const BRAND = {
  accent:   '#455BF1',
  lavender: '#9D93D6',
  coral:    '#F2AEAC',
  red:      '#E20419',
  dim:      'gray',
}

// ── Config paths ─────────────────────────────────────────────
const NEHANDA_DIR   = path.join(os.homedir(), '.config', 'nehanda')
const NEHANDA_DB    = path.join(NEHANDA_DIR, 'ona-session.db')
const AIMEE_DIR     = path.join(os.homedir(), '.config', 'aimee')
const AGENTS_JSON   = path.join(AIMEE_DIR,   'agents.json')
const SPLASH_SEEN   = path.join(NEHANDA_DIR, '.splash-seen')

function hasSeenSplash() { try { return fs.existsSync(SPLASH_SEEN) } catch { return false } }
function markSplashSeen() {
  try { fs.mkdirSync(NEHANDA_DIR, { recursive: true }); fs.writeFileSync(SPLASH_SEEN, new Date().toISOString()) }
  catch {}
}

// ── Config helpers ────────────────────────────────────────────
function readAgents() {
  try { return JSON.parse(fs.readFileSync(AGENTS_JSON, 'utf8')) }
  catch { return { agents: [], default_agent: '' } }
}

/** Nehanda API key: stored in agents.json api_key or NEHANDA_API_KEY env var. */
function readApiKey() {
  const data  = readAgents()
  const agent = data.agents?.find(a => a.name === data.default_agent) || data.agents?.[0]
  return agent?.api_key || process.env.NEHANDA_API_KEY || ''
}

function writeApiKey(key) {
  const data  = readAgents()
  const agent = data.agents?.find(a => a.name === data.default_agent) || data.agents?.[0]
  if (agent) { agent.api_key = key; fs.writeFileSync(AGENTS_JSON, JSON.stringify(data, null, 2), 'utf8') }
}

// ── Session DB bootstrap ─────────────────────────────────────
fs.mkdirSync(NEHANDA_DIR, { recursive: true })
const sessionDb = new Database(NEHANDA_DB)
sessionDb.exec(`
  CREATE TABLE IF NOT EXISTS conversations(
    id TEXT PRIMARY KEY, project_dir TEXT,
    phase TEXT DEFAULT 'idle',
    last_active TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS transcript_entries(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL, sequence INTEGER NOT NULL,
    entry_type TEXT NOT NULL, payload_json TEXT NOT NULL,
    tool_use_id TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS plans(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL, content TEXT,
    hash TEXT, status TEXT DEFAULT 'draft', approved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS events(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    event_type TEXT NOT NULL, detail TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS summaries(
    conversation_id TEXT PRIMARY KEY,
    content TEXT, word_count INTEGER,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`)

// ── Markdown ─────────────────────────────────────────────────
marked.setOptions({
  renderer: new TerminalRenderer({
    code:      chalk.hex(BRAND.lavender),
    codespan:  chalk.hex(BRAND.lavender),
    strong:    chalk.bold,
    em:        chalk.italic,
    heading:   chalk.bold.hex(BRAND.accent),
    hr:        () => chalk.dim('─'.repeat(50)),
    paragraph: text => text + '\n',
    link:      (href, _t, text) => `${text} ${chalk.dim.underline(href)}`,
  })
})
function renderMd(text) {
  if (!text) return ''
  try { return marked(text).replace(/\n{3,}/g, '\n\n').trimEnd() }
  catch { return text }
}

// ── Constants ────────────────────────────────────────────────
const SPINNER_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']
const SLASH_COMMANDS = [
  { name: '/model',  desc: 'Change model endpoint' },
  { name: '/key',    desc: 'Set Nehanda API key' },
  { name: '/config', desc: 'Show current config' },
  { name: '/clear',  desc: 'New conversation' },
  { name: '/retry',  desc: 'Resend the last failed message' },
  { name: '/help',   desc: 'Show commands' },
  { name: '/exit',   desc: 'Quit' },
]

// ── Model registry ────────────────────────────────────────────
const DEFAULT_REGISTRY = {
  ollama_hosts: ['http://AsobaCorp-1.local:11434'],
  models: [
    { name: 'nehanda-rag-synthesis-27b', endpoint: 'https://nehanda-ml.asoba.co/v1',   label: 'Nehanda 27B (EC2)',          desc: 'Primary — fine-tuned Qwen3.6 27B, vLLM, af-south-1' },
    { name: 'deepseek-coder-v2:latest',  endpoint: 'http://AsobaCorp-1.local:11434/v1', label: 'DeepSeek Coder V2 (LAN)',    desc: 'Windows LAN delegate — coding specialist' },
    { name: 'qwen2.5:14b',              endpoint: 'http://AsobaCorp-1.local:11434/v1', label: 'Qwen 2.5 14B (LAN)',          desc: 'Windows LAN delegate — general reasoning' },
  ],
}
function readRegistry() {
  try { return JSON.parse(fs.readFileSync(path.join(AIMEE_DIR, 'model-registry.json'), 'utf8')) }
  catch { return DEFAULT_REGISTRY }
}
async function discoverOllamaModels(hosts) {
  const out = []
  await Promise.all(hosts.map(async host => {
    const base = host.replace(/\/$/, '')
    try {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) })
      if (!res.ok) return
      const data = await res.json()
      for (const m of (data.models || []))
        out.push({ name: m.name, endpoint: `${base}/v1`, label: `${m.name} (${new URL(base).hostname})`, desc: `Discovered — ${m.name}`, discovered: true })
    } catch {}
  }))
  return out
}
async function buildModelList() {
  const reg  = readRegistry()
  const base = reg.models || []
  const disc = await discoverOllamaModels(reg.ollama_hosts || [])
  const keys = new Set(base.map(m => `${m.name}|${m.endpoint}`))
  return [...base, ...disc.filter(m => !keys.has(`${m.name}|${m.endpoint}`))]
}

// ── Asoba lock-up (compact) ───────────────────────────────────
function AsobaMark() {
  return e(Box, { flexDirection: 'column', alignItems: 'center' },
    e(Text, {}, e(Text, { color: BRAND.accent }, '▐▐▐ ')),
    e(Text, { bold: true }, 'N E H A N D A'),
    e(Text, { dimColor: true }, 'by Asoba'),
  )
}

const ASOBA_BADGE = `                                                  
                  ............'.                  
              '....................'              
           ............................           
         ................................         
       ....................................       
      ......................................      
     ........................................     
   \`.................;(LwwU{,.................    
   ...............I&$$$$$$$$$$a^...............   
  .............."W$$$$@$@@$@$$$$Y...............  
  .............,@$$$$$$$$$$$@$@$$O..............  
 '.............W$$$$$$t...^M$$$$$@;.............  
 '.............$$$@$$/.....'@$$$$@{.............  
 ..............@$$$$@u......@$$@$$).............  
 ..............k$$$$@@q:..:.B$$$$$).............  
  .............\`8$$$@$$$$$W'B$$$$$).............  
  ..............'q$@$$$$$$W'B$@$$$).............  
   ...............\`d$@$$@$W'B@$$$$(............   
   ..................'I]|[l....................   
    .........................................'    
     .......................................'     
      .....................................       
        ..................................        
          ..............................          
             ........................             
                ..................                
                        \`\``

const BADGE_DOT = new Set([' ','.', "'", '`',',',':',';','^'])
function BadgeLine({ line }) {
  const runs = []
  for (const ch of line) {
    const cls = BADGE_DOT.has(ch) ? 'dot' : 'glyph'
    const last = runs[runs.length - 1]
    if (last && last.cls === cls) last.text += ch
    else runs.push({ cls, text: ch })
  }
  return e(Text, {}, ...runs.map((r, i) => e(Text, {
    key: String(i), color: r.cls === 'glyph' ? BRAND.accent : undefined,
    bold: r.cls === 'glyph', dimColor: r.cls === 'dot',
  }, r.text)))
}
function AsobaBadge() {
  const lines = ASOBA_BADGE.split('\n')
  return e(Box, { flexDirection: 'column', alignItems: 'center' },
    ...lines.map((l, i) => e(BadgeLine, { key: String(i), line: l })))
}
function SplashScreen({ onDone }) {
  useInput(() => onDone())
  React.useEffect(() => { const t = setTimeout(onDone, 1400); return () => clearTimeout(t) }, [onDone])
  let cols = 80; try { cols = process.stdout.columns || 80 } catch {}
  const bw = Math.max(...ASOBA_BADGE.split('\n').map(l => l.length))
  return e(Box, { flexDirection: 'column', alignItems: 'center', marginY: 1 },
    cols >= bw + 4 ? e(AsobaBadge, {}) : e(AsobaMark, {}),
    e(Box, { marginTop: 1 }, e(Text, { bold: true, color: BRAND.accent }, 'NEHANDA')),
    e(Text, { dimColor: true }, 'by Asoba'),
    e(Box, { marginTop: 1 }, e(Text, { dimColor: true }, 'press any key to continue…')),
  )
}
function WelcomeBanner({ model, endpoint }) {
  let cols = 80; try { cols = process.stdout.columns || 80 } catch {}
  const bw = Math.min(cols - 2, 80)
  const lw = Math.floor(bw * 0.42), rw = bw - lw - 3
  return e(Box, { flexDirection: 'column', borderStyle: 'single', borderColor: BRAND.accent, width: bw, marginBottom: 1 },
    e(Box, { flexDirection: 'row', paddingX: 1 },
      e(Box, { flexDirection: 'column', width: lw, alignItems: 'center', paddingY: 1 },
        e(AsobaMark, {}), e(Text, { dimColor: true }, model || '—')),
      e(Box, { width: 1, borderStyle: 'single', borderColor: BRAND.accent, borderTop: false, borderBottom: false, borderRight: false, borderLeft: true }),
      e(Box, { flexDirection: 'column', width: rw, paddingLeft: 1, paddingY: 1 },
        e(Text, { bold: true, color: BRAND.accent }, 'Configuration'),
        e(Box, { marginTop: 1, flexDirection: 'column' },
          e(Text, {}, e(Text, { dimColor: true }, 'Model:    '), e(Text, { color: BRAND.lavender, bold: true }, model || '—')),
          e(Text, {}, e(Text, { dimColor: true }, 'Endpoint: '), e(Text, { dimColor: true }, endpoint || '—')),
        ),
        e(Box, { marginTop: 1 }, e(Text, { dimColor: true }, 'Type /help for commands')),
      ),
    ),
  )
}

// ── Message view ─────────────────────────────────────────────
function MessageView({ msg }) {
  if (msg.role === 'user')
    return e(Box, { flexDirection: 'row' }, e(Text, { bold: true, color: BRAND.accent }, '❯ '),
      e(Box, { flexShrink: 1 }, e(Text, { wrap: 'wrap' }, msg.text)))
  if (msg.role === 'assistant') {
    if (!msg.text) return msg.cancelled
      ? e(Box, { flexDirection: 'row' }, e(Text, { dimColor: true }, '● '), e(Text, { dimColor: true, italic: true }, '(cancelled)'))
      : null
    return e(Box, { flexDirection: 'row' }, e(Text, { dimColor: true }, '● '),
      e(Box, { flexDirection: 'column', flexShrink: 1 },
        e(Text, {}, renderMd(msg.text)),
        msg.cancelled ? e(Text, { dimColor: true, italic: true }, '⏹ cancelled') : null))
  }
  if (msg.role === 'system')
    return e(Box, { marginLeft: 1 }, e(Text, { dimColor: true }, msg.text))
  if (msg.role === 'error')
    return e(Box, { marginLeft: 1 }, e(Text, { color: BRAND.red }, '✗ ' + msg.text))
  return null
}
function Spinner({ label }) {
  const [frame, setFrame] = React.useState(0)
  React.useEffect(() => { const t = setInterval(() => setFrame(f => (f + 1) % SPINNER_FRAMES.length), 80); return () => clearInterval(t) }, [])
  return e(Box, { marginLeft: 1 }, e(Text, { color: BRAND.accent }, SPINNER_FRAMES[frame] + ' '), e(Text, { dimColor: true }, label || 'Thinking…'))
}
function SlashMenu({ filter }) {
  const matches = SLASH_COMMANDS.filter(c => c.name.startsWith(filter) || c.name.includes(filter.slice(1)))
  if (!matches.length) return null
  return e(Box, { flexDirection: 'column', marginLeft: 2 },
    ...matches.map((c, i) => e(Box, { key: String(i) },
      e(Text, { color: BRAND.accent }, c.name.padEnd(12)), e(Text, { dimColor: true }, c.desc))))
}
function InputArea({ onSubmit, isLoading }) {
  const [value, setValue] = React.useState('')
  const showMenu = value.startsWith('/') && !value.includes(' ')
  const handleSubmit = React.useCallback(v => { if (!v.trim()) return; setValue(''); onSubmit(v.trim()) }, [onSubmit])
  if (isLoading) return e(Box, { paddingX: 1 }, e(Text, { dimColor: true }, 'esc to cancel'))
  return e(Box, { flexDirection: 'column' },
    showMenu ? e(SlashMenu, { filter: value }) : null,
    e(Box, { paddingX: 1 }, e(Text, { bold: true, color: BRAND.accent }, '❯ '),
      e(TextInput, { value, onChange: setValue, onSubmit: handleSubmit })))
}
function AskPrompt({ question, onAnswer, onCancel }) {
  const [value, setValue] = React.useState('')
  useInput((_input, key) => { if (key.escape) onCancel() })
  return e(Box, { flexDirection: 'column' },
    e(Box, { marginLeft: 1 }, e(Text, { dimColor: true }, question)),
    e(Box, { paddingX: 1 }, e(Text, { color: BRAND.accent }, '❯ '),
      e(TextInput, { value, onChange: setValue, onSubmit: React.useCallback(v => onAnswer(v.trim()), [onAnswer]) })),
    e(Box, { marginLeft: 1 }, e(Text, { dimColor: true }, 'Esc cancel')))
}
function SelectMenu({ title, items, onSelect, onCancel }) {
  const [idx, setIdx] = React.useState(0)
  useInput((input, key) => {
    if (key.escape)    { onCancel(); return }
    if (key.upArrow)   { setIdx(i => (i - 1 + items.length) % items.length); return }
    if (key.downArrow) { setIdx(i => (i + 1) % items.length); return }
    if (key.return)    { onSelect(items[idx]); return }
    const n = parseInt(input, 10)
    if (!isNaN(n) && n >= 1 && n <= items.length) onSelect(items[n - 1])
  })
  return e(Box, { flexDirection: 'column', marginLeft: 1 },
    e(Text, { bold: true, color: BRAND.accent }, title),
    e(Box, { marginTop: 1, flexDirection: 'column' },
      ...items.map((item, i) => {
        const active = i === idx
        return e(Box, { key: String(i), flexDirection: 'column' },
          e(Box, {}, e(Text, { color: active ? BRAND.accent : undefined }, active ? '❯ ' : '  '),
            e(Text, { color: BRAND.lavender }, `${i + 1}. `),
            e(Text, { bold: true, color: active ? BRAND.accent : undefined }, item.label)),
          e(Box, { marginLeft: 5 }, e(Text, { dimColor: true }, item.desc)))
      })),
    e(Box, { marginTop: 1 }, e(Text, { dimColor: true },
      '↑↓ navigate · Enter select' + (items.length <= 9 ? ` · 1–${items.length} jump` : '') + ' · Esc cancel')))
}
function TokenFooter({ calls, model }) {
  let cols = 80; try { cols = process.stdout.columns || 80 } catch {}
  return e(Box, { flexDirection: 'column' },
    e(Text, { dimColor: true }, '─'.repeat(cols)),
    e(Box, { flexDirection: 'row', paddingX: 1, justifyContent: 'space-between' },
      e(Text, { dimColor: true }, `calls ${calls}`),
      e(Text, {}, e(Text, { dimColor: true }, 'model: '), e(Text, { color: BRAND.lavender }, model || '—')),
      e(Text, { dimColor: true }, '? /help  ^C exit')))
}

// ── Main App ──────────────────────────────────────────────────
function App({ bridge }) {
  const { exit } = useApp()
  const [showSplash, setShowSplash] = React.useState(() => !hasSeenSplash())
  const [finalized,  setFinalized]  = React.useState([])
  const [streaming,  setStreaming]  = React.useState(null)
  const [clearGen,   setClearGen]   = React.useState(0)
  const [isLoading,  setIsLoading]  = React.useState(false)
  const [askState,   setAskState]   = React.useState(null)
  const [selectState, setSelectState] = React.useState(null)
  const [callCount,  setCallCount]  = React.useState(0)
  const [modelInfo,  setModelInfo]  = React.useState(() => {
    const data = readAgents()
    const ag = data.agents?.find(a => a.name === data.default_agent) || data.agents?.[0]
    return { model: ag?.model || 'nehanda-rag-synthesis-27b', endpoint: ag?.endpoint || 'https://nehanda-ml.asoba.co/v1' }
  })
  const lastCtrlCRef = React.useRef(0)
  const bannerRef    = React.useRef({ kind: 'banner' })
  const historyItems = React.useMemo(() => [bannerRef.current, ...finalized], [finalized])

  React.useEffect(() => {
    bridge.addMessage     = msg  => setFinalized(p => [...p, msg])
    bridge.beginAssistant = ()   => setStreaming({ text: '' })
    bridge.updateAssistant= text => setStreaming({ text })
    bridge.discardAssistant=()   => setStreaming(null)
    bridge.endAssistant   = msg  => { setFinalized(p => [...p, msg]); setStreaming(null); setCallCount(c => c + 1) }
    bridge.clearMessages  = ()   => { setFinalized([]); setStreaming(null); setClearGen(g => g + 1) }
    bridge.setLoading     = v    => setIsLoading(v)
    bridge.ask    = q     => new Promise(resolve => setAskState({ question: q, resolve }))
    bridge.select = (t,i) => new Promise(resolve => setSelectState({ title: t, items: i, resolve }))
    bridge.exit   = ()    => { exit() }
    bridge.refreshModel = () => {
      const data = readAgents()
      const ag = data.agents?.find(a => a.name === data.default_agent) || data.agents?.[0]
      setModelInfo({ model: ag?.model || 'nehanda-rag-synthesis-27b', endpoint: ag?.endpoint || 'https://nehanda-ml.asoba.co/v1' })
    }
  }, [bridge, exit])

  const handleAnswer = React.useCallback(answer => {
    if (askState?.resolve) { setFinalized(p => [...p, { role: 'system', text: askState.question + ' ' + answer }]); askState.resolve(answer) }
    setAskState(null)
  }, [askState])
  const handleAskCancel = React.useCallback(() => { askState?.resolve(null); setAskState(null) }, [askState])
  const handleSelect    = React.useCallback(item => {
    if (selectState?.resolve) { setFinalized(p => [...p, { role: 'system', text: `  Selected: ${item.label}` }]); selectState.resolve(item) }
    setSelectState(null)
  }, [selectState])
  const handleSelectCancel = React.useCallback(() => { selectState?.resolve(null); setSelectState(null) }, [selectState])

  useInput((input, key) => {
    if (key.escape) { if (isLoading && bridge.abortCurrent) bridge.abortCurrent(); return }
    if (key.ctrl && input === 'c') {
      if (isLoading && bridge.abortCurrent) { bridge.abortCurrent(); return }
      const now = Date.now()
      if (now - lastCtrlCRef.current < 1200) { exit(); process.exit(0) }
      lastCtrlCRef.current = now
      bridge.addMessage({ role: 'system', text: '  (press Ctrl+C again to exit)' })
    }
  })

  if (showSplash)
    return e(SplashScreen, { onDone: () => { markSplashSeen(); setShowSplash(false) } })

  return e(Box, { flexDirection: 'column' },
    e(Static, { items: historyItems, key: clearGen },
      (item, i) => item.kind === 'banner'
        ? e(WelcomeBanner, { key: 'banner', model: modelInfo.model, endpoint: modelInfo.endpoint })
        : e(MessageView,   { key: String(i), msg: item })),
    streaming ? e(MessageView, { msg: { role: 'assistant', ...streaming } }) : null,
    isLoading && (!streaming || !streaming.text) ? e(Spinner, {}) : null,
    askState
      ? e(AskPrompt, { question: askState.question, onAnswer: handleAnswer, onCancel: handleAskCancel })
      : selectState
        ? e(SelectMenu, { title: selectState.title, items: selectState.items, onSelect: handleSelect, onCancel: handleSelectCancel })
        : e(InputArea, { onSubmit: bridge.onSubmit, isLoading }),
    e(TokenFooter, { calls: callCount, model: modelInfo.model }))
}

// ── Diff executor ─────────────────────────────────────────────
function applyDiffBlocks(text, bridge) {
  const re = /^(.+?\.(?:\w+))\s*\n<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n([\s\S]*?)\n?>>>>>>> REPLACE/gm
  let match
  while ((match = re.exec(text)) !== null) {
    const [, filepath, search, replace] = match
    try {
      const abs = path.isAbsolute(filepath) ? filepath : path.resolve(process.cwd(), filepath)
      if (!fs.existsSync(abs)) { bridge.addMessage({ role: 'error', text: `✗ File not found: ${filepath}` }); continue }
      const content = fs.readFileSync(abs, 'utf-8')
      if (!content.includes(search)) { bridge.addMessage({ role: 'error', text: `✗ Search block not found: ${filepath}` }); continue }
      fs.writeFileSync(abs, content.replace(search, replace), 'utf-8')
      bridge.addMessage({ role: 'system', text: `  ${chalk.green('✓')} Applied diff to ${chalk.bold(filepath)}` })
    } catch (err) {
      bridge.addMessage({ role: 'error', text: `✗ ${filepath}: ${err.message}` })
    }
  }
}

// ── Thinking trace stripper ───────────────────────────────────
function stripThink(text) {
  return (text || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*/g, '')
    .trim()
}

// ── Command handler ───────────────────────────────────────────
async function handleCommand(cmd, bridge) {
  const [name] = cmd.split(/\s+/)

  if (name === '/help') {
    bridge.addMessage({ role: 'system', text: '\nCommands:\n' +
      SLASH_COMMANDS.map(c => `  ${chalk.hex(BRAND.accent)(c.name.padEnd(12))} ${chalk.dim(c.desc)}`).join('\n') + '\n' })
    return
  }
  if (name === '/config') {
    const data = readAgents()
    const ag   = data.agents?.find(a => a.name === data.default_agent) || data.agents?.[0]
    bridge.addMessage({ role: 'system', text: [
      '', `  Model:    ${chalk.hex(BRAND.accent)(ag?.model || '—')}`,
      `  Endpoint: ${chalk.dim(ag?.endpoint || '—')}`,
      `  API key:  ${readApiKey() ? chalk.green('set') : chalk.hex(BRAND.red)('not set')}`, '',
    ].join('\n') })
    return
  }
  if (name === '/clear') {
    bridge.clearMessages()
    bridge.addMessage({ role: 'system', text: '  Conversation cleared.' })
    bridge.convId = `nehanda-${Date.now()}`   // new conversation ID resets transcript
    return
  }
  if (name === '/retry') {
    if (!bridge.lastFailedText) { bridge.addMessage({ role: 'system', text: '  Nothing to retry.' }); return }
    const t = bridge.lastFailedText; bridge.lastFailedText = null; await bridge.onSubmit(t); return
  }
  if (name === '/exit' || name === '/quit') { bridge.exit(); process.exit(0) }
  if (name === '/key') {
    const answer = await bridge.ask('New Nehanda API key:')
    if (!answer) return
    try { writeApiKey(answer); bridge.addMessage({ role: 'system', text: `  ${chalk.green('✓')} API key updated.` }) }
    catch (err) { bridge.addMessage({ role: 'error', text: 'Failed: ' + err.message }) }
    return
  }
  if (name === '/model') {
    bridge.addMessage({ role: 'system', text: '  Discovering models…' })
    const all   = await buildModelList()
    const cur   = readAgents().agents?.[0]?.model || ''
    const items = all.map(m => ({ ...m, label: m.name === cur ? `${m.label} ✓` : m.label }))
    const sel   = await bridge.select('Select model', items)
    if (!sel) return
    try {
      const data = readAgents()
      const ag   = data.agents?.find(a => a.name === data.default_agent) || data.agents?.[0]
      if (ag) { ag.model = sel.name; ag.endpoint = sel.endpoint }
      fs.writeFileSync(AGENTS_JSON, JSON.stringify(data, null, 2), 'utf8')
      bridge.refreshModel()
      bridge.addMessage({ role: 'system', text: `  ${chalk.green('✓')} Model → ${chalk.bold(sel.name)}` })
    } catch (err) { bridge.addMessage({ role: 'error', text: 'Failed: ' + err.message }) }
    return
  }
  bridge.addMessage({ role: 'system', text: `  Unknown command: ${name}. Type /help.` })
}

// ── Entry point ───────────────────────────────────────────────
const bridge = {
  convId:          `nehanda-${Date.now()}`,
  lastFailedText:  null,
}

bridge.onSubmit = async (text) => {
  bridge.addMessage({ role: 'user', text })
  if (text.startsWith('/')) { await handleCommand(text, bridge); return }

  bridge.setLoading(true)
  const controller = new AbortController()
  bridge.abortCurrent = () => controller.abort()
  let lastPartial = ''

  try {
    bridge.beginAssistant()

    const agentsData = readAgents()
    const agent      = agentsData.agents?.find(a => a.name === agentsData.default_agent) || agentsData.agents?.[0]

    // Ensure conversation row exists for this convId
    sessionDb.prepare(
      `INSERT OR IGNORE INTO conversations(id, project_dir, phase) VALUES (?, ?, 'idle')`
    ).run(bridge.convId, process.cwd())

    const rt = {
      sessionId:       bridge.convId,
      conversationId:  bridge.convId,
      cwd:             process.cwd(),
      runtimeDbPath:   null,
      bareMode:        false,
      onaInstructions: null,
      settings: {
        model_config: {
          provider: 'nehanda',
          model_id:  'nehanda_rag_synthesis_27b',
          base_url:  agent?.endpoint || process.env.NEHANDA_BASE_URL || 'https://nehanda-ml.asoba.co/v1',
          api_key:   readApiKey(),
        },
        permissions: { defaultMode: 'default' },
      },
    }

    let fullText = '', aborted = false
    controller.signal.addEventListener('abort', () => { aborted = true })

    const io = {
      write(chunk) {
        if (aborted) return
        fullText += chunk
        lastPartial = stripThink(fullText).trimStart()
        bridge.updateAssistant(lastPartial)
      },
      println(msg)            { if (!aborted) bridge.addMessage({ role: 'system', text: '  ' + msg }) },
      spinner:                { start() {}, stop() {} },
      ask:                    bridge.ask,
      onToolStart(name)       { if (!aborted) bridge.addMessage({ role: 'system', text: `  ⚙ ${name}` }) },
      onToolResult(name, c, err) {
        if (aborted) return
        const preview = String(c || '').slice(0, 120).replace(/\n/g, ' ')
        bridge.addMessage({ role: 'system', text: `  ${err ? '✗' : '✓'} ${name}: ${preview}` })
      },
    }

    await runUserTurn(sessionDb, rt, text, io)

    if (aborted) { const e = new Error('abort'); e.name = 'AbortError'; throw e }

    const reply = stripThink(fullText)
    bridge.endAssistant({ role: 'assistant', text: reply })
    applyDiffBlocks(reply, bridge)
    bridge.lastFailedText = null

  } catch (err) {
    if (err.name === 'AbortError') {
      bridge.endAssistant({ role: 'assistant', text: lastPartial, cancelled: true })
    } else {
      bridge.discardAssistant()
      bridge.addMessage({ role: 'error', text: err.message + '\n  Type /retry to resend.' })
      bridge.lastFailedText = text
    }
  } finally {
    bridge.setLoading(false)
    bridge.abortCurrent = null
  }
}

render(e(App, { bridge }), { exitOnCtrlC: false })
