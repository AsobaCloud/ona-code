// Ink-based terminal UI — reference parity with claude-code
// Components: Banner, MessageList, ToolCallDisplay, PromptInput, Spinner, StatusBar
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { render, Box, Text, useInput, useApp, useStdin } from 'ink'
import TextInput from 'ink-text-input'
import { marked } from 'marked'
import TerminalRenderer from 'marked-terminal'
import chalk from 'chalk'

const e = React.createElement
const TOOL_PREFIX = '  ⎿  '
const ASSISTANT_PREFIX = '  ⎿  '

// ── Markdown rendering ───────────────────────────────────────
marked.setOptions({
  renderer: new TerminalRenderer({
    code: chalk.yellow,
    codespan: chalk.yellow,
    strong: chalk.bold,
    em: chalk.italic,
    heading: chalk.bold.cyan,
    hr: () => chalk.dim('─'.repeat(50)),
    listitem: text => `  ${chalk.dim('•')} ${text}`,
    paragraph: text => text + '\n',
    link: (href, title, text) => `${text} ${chalk.dim.underline(href)}`,
  })
})

function renderMd(text) {
  if (!text) return ''
  try { return marked(text).replace(/\n{3,}/g, '\n\n').trimEnd() }
  catch { return text }
}

// ── Slash command definitions for filter ─────────────────────
const SLASH_COMMANDS = [
  { name: '/help', desc: 'Show available commands' },
  { name: '/model', desc: 'Show or change active model' },
  { name: '/login', desc: 'Authenticate with provider' },
  { name: '/logout', desc: 'Clear stored credentials' },
  { name: '/status', desc: 'Show credential status' },
  { name: '/config', desc: 'Show current settings' },
  { name: '/clear', desc: 'Clear conversation' },
  { name: '/exit', desc: 'Quit' },
]

// ── Banner Component ─────────────────────────────────────────
function Banner({ version, provider, wireModel, endpoint, dbPath, bare }) {
  return e(Box, { flexDirection: 'column', marginBottom: 1 },
    e(Box, { marginLeft: 2 },
      e(Text, { bold: true, color: '#cc785c' }, '◆ '),
      e(Text, { bold: true }, 'ona'),
      e(Text, { dimColor: true }, ` v${version}`),
      bare ? e(Text, { dimColor: true }, ' [bare]') : null
    ),
    e(Box, { marginLeft: 4, flexDirection: 'column' },
      e(Text, { dimColor: true }, `${provider} › ${wireModel}`),
      e(Text, { dimColor: true }, endpoint),
    ),
    e(Box, { marginLeft: 4, marginTop: 0 },
      e(Text, { dimColor: true }, `DB: ${dbPath}`)
    ),
  )
}

// ── Message Component ────────────────────────────────────────
function MessageView({ msg }) {
  if (msg.role === 'user') {
    return e(Box, { marginLeft: 0, marginBottom: 0 },
      e(Text, { bold: true, color: '#cc785c' }, '❯ '),
      e(Text, {}, msg.text)
    )
  }
  if (msg.role === 'assistant') {
    return e(Box, { marginLeft: 0, marginBottom: 0, flexDirection: 'column' },
      e(Text, {}, renderMd(msg.text))
    )
  }
  if (msg.role === 'tool_start') {
    return e(Box, { marginLeft: 0 },
      e(Text, { dimColor: true }, TOOL_PREFIX),
      e(Text, { bold: true, color: 'yellow' }, msg.toolName),
    )
  }
  if (msg.role === 'tool_result') {
    const icon = msg.isError ? e(Text, { color: 'red' }, '✗ ') : e(Text, { color: 'green' }, '✓ ')
    const preview = (msg.text || '').split('\n')[0].slice(0, 80)
    return e(Box, { marginLeft: 0 },
      e(Text, { dimColor: true }, TOOL_PREFIX),
      icon,
      e(Text, { dimColor: true }, preview),
    )
  }
  if (msg.role === 'system') {
    return e(Box, { marginLeft: 2 },
      e(Text, { dimColor: true, italic: true }, msg.text),
    )
  }
  if (msg.role === 'streaming') {
    return e(Box, { marginLeft: 0, flexDirection: 'column' },
      e(Text, {}, msg.text),
    )
  }
  return null
}

// ── Spinner Component ────────────────────────────────────────
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function Spinner({ label }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % SPINNER_FRAMES.length), 80)
    return () => clearInterval(t)
  }, [])
  return e(Box, { marginLeft: 2 },
    e(Text, { color: '#cc785c' }, SPINNER_FRAMES[frame] + ' '),
    e(Text, { dimColor: true }, label || 'Thinking…'),
  )
}

// ── Slash command filter menu ────────────────────────────────
function SlashMenu({ filter }) {
  const matches = SLASH_COMMANDS.filter(c =>
    c.name.startsWith(filter) || c.name.includes(filter)
  )
  if (!matches.length) return null
  return e(Box, { flexDirection: 'column', marginLeft: 2, marginBottom: 0 },
    ...matches.map((c, i) =>
      e(Box, { key: i },
        e(Text, { color: 'cyan' }, c.name.padEnd(14)),
        e(Text, { dimColor: true }, c.desc),
      )
    )
  )
}

// ── Input Component ──────────────────────────────────────────
function PromptInputArea({ onSubmit, isLoading }) {
  const [value, setValue] = useState('')
  const showSlashMenu = value.startsWith('/') && !value.includes(' ')

  const handleSubmit = useCallback((v) => {
    if (!v.trim()) return
    setValue('')
    onSubmit(v.trim())
  }, [onSubmit])

  if (isLoading) return null

  return e(Box, { flexDirection: 'column' },
    showSlashMenu ? e(SlashMenu, { filter: value }) : null,
    e(Box, {},
      e(Text, { bold: true, color: '#cc785c' }, '❯ '),
      e(TextInput, {
        value,
        onChange: setValue,
        onSubmit: handleSubmit,
        placeholder: 'Type a message or /command…',
      }),
    )
  )
}

// ── Main App ─────────────────────────────────────────────────
export function App({ config, onUserInput, onExit }) {
  const { exit } = useApp()
  const [messages, setMessages] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [streamText, setStreamText] = useState('')

  // Expose state setters to the host
  const ref = useRef({ setMessages, setIsLoading, setStreamText, messages })
  ref.current.messages = messages
  useEffect(() => {
    if (config._bridge) {
      config._bridge.setMessages = setMessages
      config._bridge.setIsLoading = setIsLoading
      config._bridge.setStreamText = setStreamText
      config._bridge.getMessages = () => ref.current.messages
      config._bridge.exit = () => { exit(); onExit?.() }
    }
  }, [config._bridge, exit, onExit])

  const handleSubmit = useCallback((text) => {
    // Add user message immediately
    setMessages(prev => [...prev, { role: 'user', text }])
    onUserInput(text)
  }, [onUserInput])

  return e(Box, { flexDirection: 'column', paddingBottom: 0 },
    // Banner
    e(Banner, {
      version: config.version,
      provider: config.provider,
      wireModel: config.wireModel,
      endpoint: config.endpoint,
      dbPath: config.dbPath,
      bare: config.bare,
    }),

    // Messages
    ...messages.map((msg, i) => e(MessageView, { key: i, msg })),

    // Streaming text
    streamText ? e(Box, { marginLeft: 0 },
      e(Text, {}, streamText)
    ) : null,

    // Spinner
    isLoading ? e(Spinner, { label: 'Thinking…' }) : null,

    // Input
    e(Box, { marginTop: messages.length > 0 ? 0 : 0 },
      e(PromptInputArea, { onSubmit: handleSubmit, isLoading })
    ),
  )
}

// ── Render entry point ───────────────────────────────────────
export function startApp(config) {
  const bridge = {}
  config._bridge = bridge

  const instance = render(
    e(App, {
      config,
      onUserInput: config.onUserInput,
      onExit: config.onExit,
    }),
    { exitOnCtrlC: true }
  )

  return {
    bridge,
    instance,
    // Helper methods for the orchestrator
    addMessage(msg) {
      bridge.setMessages?.(prev => [...prev, msg])
    },
    startLoading() {
      bridge.setIsLoading?.(true)
      bridge.setStreamText?.('')
    },
    stopLoading() {
      bridge.setIsLoading?.(false)
    },
    updateStream(text) {
      bridge.setStreamText?.(text)
    },
    clearStream() {
      bridge.setStreamText?.('')
    },
    addSystemMessage(text) {
      bridge.setMessages?.(prev => [...prev, { role: 'system', text }])
    },
    addToolStart(toolName) {
      bridge.setMessages?.(prev => [...prev, { role: 'tool_start', toolName }])
    },
    addToolResult(toolName, text, isError) {
      bridge.setMessages?.(prev => [...prev, { role: 'tool_result', toolName, text, isError }])
    },
    addAssistantMessage(text) {
      bridge.setMessages?.(prev => [...prev, { role: 'assistant', text }])
    },
    exit() {
      bridge.exit?.()
    }
  }
}
