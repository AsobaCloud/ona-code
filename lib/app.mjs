// Ink-based terminal UI — ported from claude-code/components/LogoV2/, messages/, PromptInput/
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { render, Box, Text, useApp, useStdout } from 'ink'
import TextInput from 'ink-text-input'
import { marked } from 'marked'
import TerminalRenderer from 'marked-terminal'
import chalk from 'chalk'

const e = React.createElement

// Figures — claude-code/constants/figures.ts
const BLACK_CIRCLE = process.platform === 'darwin' ? '\u23FA' : '\u25CF'
const TICK = '\u2713'
const CROSS = '\u2717'
const BULLET = '\u2219'

// ── Markdown rendering ───────────────────────────────────────
marked.setOptions({
  renderer: new TerminalRenderer({
    code: chalk.yellow,
    codespan: chalk.yellow,
    strong: chalk.bold,
    em: chalk.italic,
    heading: chalk.bold.cyan,
    hr: () => chalk.dim('\u2500'.repeat(50)),
    listitem: text => `  ${chalk.dim('\u2022')} ${text}`,
    paragraph: text => text + '\n',
    link: (href, title, text) => `${text} ${chalk.dim.underline(href)}`,
  })
})

function renderMd(text) {
  if (!text) return ''
  try { return marked(text).replace(/\n{3,}/g, '\n\n').trimEnd() }
  catch { return text }
}

// ── Cape Town skyline — Table Mountain, Lion's Head, city lights ──
function CapeTownSkyline() {
  return e(Box, { flexDirection: 'column', alignItems: 'center' },
    e(Text, {},
      e(Text, { dimColor: true }, '       \u2726  '),
      e(Text, { color: 'yellow' }, '\u2600'),
    ),
    e(Text, {},
      e(Text, { color: '#cc785c' }, '  \u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584'),
      e(Text, { dimColor: true }, '  \u2726 '),
      e(Text, { color: '#cc785c' }, '\u25B2'),
    ),
    e(Text, {},
      e(Text, { color: '#cc785c' }, '  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u258C   \u259F\u258A'),
    ),
    e(Text, {},
      e(Text, { color: '#cc785c' }, ' \u259F\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2588\u2588\u258A\u2596'),
    ),
    e(Text, {},
      e(Text, { color: '#8a6040' }, ' \u2591\u2592\u2588\u2592\u2591\u2593\u2588\u2593\u2591\u2592\u2588\u2592\u2591\u2593\u2588\u2593\u2591'),
    ),
  )
}

// ── Welcome Banner — from claude-code LogoV2/LogoV2.tsx ──
function WelcomeBanner({ version, provider, wireModel, cwd, permissionMode, bare }) {
  let cols = 80
  try { cols = process.stdout.columns || 80 } catch {}

  const modelLine = `${wireModel}${bare ? ' [bare]' : ''}`
  const cwdDisplay = cwd.startsWith(process.env.HOME || '~')
    ? '~' + cwd.slice((process.env.HOME || '~').length)
    : cwd

  const bannerWidth = Math.min(cols, 80)
  const leftWidth = Math.floor(bannerWidth * 0.4)
  const rightWidth = bannerWidth - leftWidth - 3

  return e(Box, {
    flexDirection: 'column', borderStyle: 'single', borderColor: '#cc785c',
    width: bannerWidth, marginBottom: 1,
  },
    e(Box, { flexDirection: 'row', paddingX: 1 },
      // Left panel
      e(Box, { flexDirection: 'column', width: leftWidth, alignItems: 'center', paddingY: 1 },
        e(Text, { bold: true, color: '#cc785c' }, 'Welcome to ona!'),
        e(CapeTownSkyline, {}),
        e(Text, { dimColor: true }, modelLine),
        e(Text, { dimColor: true }, cwdDisplay),
      ),
      // Separator
      e(Box, { width: 1, borderStyle: 'single', borderColor: '#cc785c',
        borderTop: false, borderBottom: false, borderRight: false, borderLeft: true }),
      // Right panel
      e(Box, { flexDirection: 'column', width: rightWidth, paddingLeft: 1, paddingY: 1 },
        e(Text, { bold: true, color: '#cc785c' }, 'Tips for getting started'),
        e(Text, { dimColor: true }, 'Run /init to create an Ona.md file with instructions'),
        e(Text, { dimColor: true }, 'Use /help to see available commands'),
        e(Text, { dimColor: true }, 'Use /model to switch models'),
        e(Box, { marginTop: 1 },
          e(Text, { bold: true }, 'Recent activity'),
        ),
        e(Text, { dimColor: true }, 'No recent activity'),
      ),
    ),
  )
}

// ── Slash commands ───────────────────────────────────────────
const SLASH_COMMANDS = [
  { name: '/phase', desc: 'Current SDLC phase' },
  { name: '/plan', desc: 'Plan status' },
  { name: '/code', desc: 'Implement plan' },
  { name: '/test', desc: 'Run tests' },
  { name: '/verify', desc: 'Coverage report' },
  { name: '/done', desc: 'Complete workflow' },
  { name: '/init', desc: 'Create Ona.md' },
  { name: '/diff', desc: 'Uncommitted changes' },
  { name: '/cost', desc: 'Token usage' },
  { name: '/doctor', desc: 'Diagnostics' },
  { name: '/permissions', desc: 'Permission rules' },
  { name: '/pr-comments', desc: 'PR comments' },
  { name: '/compact', desc: 'Compact conversation' },
  { name: '/team', desc: 'Manage teams' },
  { name: '/model', desc: 'Change model' },
  { name: '/login', desc: 'Authenticate' },
  { name: '/logout', desc: 'Clear credentials' },
  { name: '/status', desc: 'Auth status' },
  { name: '/config', desc: 'Settings' },
  { name: '/clear', desc: 'New conversation' },
  { name: '/exit', desc: 'Quit' },
  { name: '/help', desc: 'All commands' },
]

// ── Message — from claude-code messages/*.tsx ────────────────
function MessageView({ msg }) {
  if (msg.role === 'user') {
    return e(Box, { marginLeft: 0, flexDirection: 'row' },
      e(Text, { bold: true, color: '#cc785c' }, '\u276F '),
      e(Box, { flexShrink: 1 }, e(Text, { wrap: 'wrap' }, msg.text))
    )
  }
  if (msg.role === 'assistant') {
    return e(Box, { flexDirection: 'column' },
      e(Text, {}, renderMd(msg.text))
    )
  }
  if (msg.role === 'tool_start') {
    return e(Box, { marginLeft: 1 },
      e(Text, { color: '#cc785c' }, `${BLACK_CIRCLE} `),
      e(Text, { bold: true }, msg.toolName),
    )
  }
  if (msg.role === 'tool_result') {
    const icon = msg.isError
      ? e(Text, { color: 'red' }, `${CROSS} `)
      : e(Text, { color: 'green' }, `${TICK} `)
    const preview = (msg.text || '').split('\n')[0].slice(0, 120)
    return e(Box, { marginLeft: 2 }, icon, e(Text, { dimColor: true }, preview))
  }
  if (msg.role === 'system') {
    return e(Box, { marginLeft: 1 }, e(Text, { dimColor: true }, msg.text))
  }
  return null
}

// ── Spinner — from claude-code Spinner/SpinnerGlyph.tsx ──────
const SPINNER_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F']

function Spinner({ label }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % SPINNER_FRAMES.length), 80)
    return () => clearInterval(t)
  }, [])
  return e(Box, { marginLeft: 1 },
    e(Text, { color: '#cc785c' }, SPINNER_FRAMES[frame] + ' '),
    e(Text, { dimColor: true }, label || 'Thinking\u2026'),
  )
}

// ── Slash menu ──────────────────────────────────────────────
function SlashMenu({ filter }) {
  const matches = SLASH_COMMANDS.filter(c => c.name.startsWith(filter) || c.name.includes(filter))
  if (!matches.length) return null
  return e(Box, { flexDirection: 'column', marginLeft: 2 },
    ...matches.map((c, i) =>
      e(Box, { key: String(i) },
        e(Text, { color: 'cyan' }, c.name.padEnd(14)),
        e(Text, { dimColor: true }, c.desc),
      )
    )
  )
}

// ── Ask prompt ──────────────────────────────────────────────
function AskPrompt({ question, onAnswer }) {
  const [value, setValue] = useState('')
  return e(Box, { flexDirection: 'column' },
    e(Box, { marginLeft: 1 }, e(Text, { dimColor: true }, question)),
    e(Box, { marginLeft: 1 },
      e(Text, { color: '#cc785c' }, '\u276F '),
      e(TextInput, { value, onChange: setValue, onSubmit: useCallback(v => onAnswer(v.trim()), [onAnswer]) }),
    ),
  )
}

// ── Input ───────────────────────────────────────────────────
function PromptInputArea({ onSubmit, isLoading }) {
  const [value, setValue] = useState('')
  const showSlashMenu = value.startsWith('/') && !value.includes(' ')

  const handleSubmit = useCallback((v) => {
    if (!v.trim()) return
    setValue('')
    onSubmit(v.trim())
  }, [onSubmit])

  if (isLoading) return null

  let cols = 80
  try { cols = process.stdout.columns || 80 } catch {}

  return e(Box, { flexDirection: 'column' },
    e(Text, { dimColor: true }, '\u2500'.repeat(cols)),
    showSlashMenu ? e(SlashMenu, { filter: value }) : null,
    e(Box, { paddingX: 1 },
      e(Text, { bold: true, color: '#cc785c' }, '\u276F '),
      e(TextInput, { value, onChange: setValue, onSubmit: handleSubmit }),
    )
  )
}

// ── Footer — from claude-code PromptInput/PromptInputFooter.tsx ──
function Footer({ phase, model, permissionMode }) {
  return e(Box, { marginTop: 1 },
    e(Text, { dimColor: true }, '? for shortcuts'),
  )
}

// ── Main App ────────────────────────────────────────────────
export function App({ config, onUserInput, onExit }) {
  const { exit } = useApp()
  const [messages, setMessages] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [askState, setAskState] = useState(null)

  const ref = useRef({ setMessages, setIsLoading, setStreamText, messages, setAskState })
  ref.current.messages = messages
  useEffect(() => {
    if (config._bridge) {
      config._bridge.setMessages = setMessages
      config._bridge.setIsLoading = setIsLoading
      config._bridge.setStreamText = setStreamText
      config._bridge.setAskState = setAskState
      config._bridge.getMessages = () => ref.current.messages
      config._bridge.exit = () => { exit(); onExit?.() }
    }
  }, [config._bridge, exit, onExit])

  const handleSubmit = useCallback((text) => {
    setMessages(prev => [...prev, { role: 'user', text }])
    onUserInput(text)
  }, [onUserInput])

  const handleAskAnswer = useCallback((answer) => {
    if (askState?.resolve) askState.resolve(answer)
    setAskState(null)
  }, [askState])

  return e(Box, { flexDirection: 'column' },
    e(WelcomeBanner, {
      version: config.version,
      provider: config.provider,
      wireModel: config.wireModel,
      cwd: config.cwd || process.cwd(),
      permissionMode: config.permissionMode || 'default',
      bare: config.bare,
    }),

    ...messages.map((msg, i) => e(MessageView, { key: String(i), msg })),

    streamText ? e(Box, {}, e(Text, {}, streamText)) : null,
    isLoading ? e(Spinner, { label: 'Thinking\u2026' }) : null,
    askState ? e(AskPrompt, { question: askState.question, onAnswer: handleAskAnswer }) : null,
    !askState ? e(Box, {}, e(PromptInputArea, { onSubmit: handleSubmit, isLoading })) : null,
    e(Footer, { phase: config.phase || 'idle', model: config.wireModel, permissionMode: config.permissionMode || 'default' }),
  )
}

// ── Render entry point ──────────────────────────────────────
export function startApp(config) {
  const bridge = {}
  config._bridge = bridge

  const instance = render(
    e(App, { config, onUserInput: config.onUserInput, onExit: config.onExit }),
    { exitOnCtrlC: true }
  )

  return {
    bridge, instance,
    addMessage(msg) { bridge.setMessages?.(prev => [...prev, msg]) },
    startLoading() { bridge.setIsLoading?.(true); bridge.setStreamText?.('') },
    stopLoading() { bridge.setIsLoading?.(false) },
    updateStream(text) { bridge.setStreamText?.(text) },
    clearStream() { bridge.setStreamText?.('') },
    addSystemMessage(text) { bridge.setMessages?.(prev => [...prev, { role: 'system', text }]) },
    addToolStart(toolName) { bridge.setMessages?.(prev => [...prev, { role: 'tool_start', toolName }]) },
    addToolResult(toolName, text, isError) { bridge.setMessages?.(prev => [...prev, { role: 'tool_result', toolName, text, isError }]) },
    addAssistantMessage(text) { bridge.setMessages?.(prev => [...prev, { role: 'assistant', text }]) },
    askUser(question) { return new Promise(resolve => { bridge.setAskState?.({ question, resolve: (ans) => { bridge.setMessages?.(prev => [...prev, { role: 'system', text: `${question} ${ans}` }]); resolve(ans) } }) }) },
    exit() { bridge.exit?.() }
  }
}
