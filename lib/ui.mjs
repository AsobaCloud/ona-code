// Terminal UI — colors, formatting, spinner, markdown rendering
// Reference: claude-code components/Spinner.tsx, components/Markdown.tsx, components/PromptInput/
import chalk from 'chalk'
import { marked } from 'marked'
import TerminalRenderer from 'marked-terminal'

// Configure marked for terminal output
marked.setOptions({
  renderer: new TerminalRenderer({
    code: chalk.yellow,
    codespan: chalk.yellow,
    strong: chalk.bold,
    em: chalk.italic,
    heading: chalk.bold.cyan,
    hr: () => chalk.dim('─'.repeat(60)),
    listitem: text => `  ${chalk.dim('•')} ${text}`,
    paragraph: text => text + '\n',
    table: chalk.reset,
    link: (href, title, text) => `${text} ${chalk.dim.underline(href)}`,
  })
})

export function renderMarkdown(text) {
  if (!text) return ''
  try {
    return marked(text).replace(/\n{3,}/g, '\n\n').trimEnd()
  } catch {
    return text
  }
}

// ── Colors ──────────────────────────────────────────────────

export const colors = {
  banner: chalk.bold.hex('#cc785c'),       // warm bronze for ona branding
  version: chalk.dim,
  provider: chalk.cyan,
  model: chalk.bold.white,
  endpoint: chalk.dim,
  prompt: chalk.bold.hex('#cc785c'),       // matches banner
  promptArrow: chalk.bold.hex('#cc785c'),
  assistant: chalk.reset,
  toolName: chalk.bold.yellow,
  toolLabel: chalk.dim.yellow,
  toolResult: chalk.dim,
  toolError: chalk.red,
  error: chalk.red,
  success: chalk.green,
  dim: chalk.dim,
  info: chalk.blue,
  warning: chalk.yellow,
  command: chalk.cyan,
  key: chalk.dim,
  value: chalk.white,
  header: chalk.bold.underline,
  separator: chalk.dim,
}

// ── Banner ──────────────────────────────────────────────────

export function printBanner(version, dbPath, bare) {
  const inner = `   ona v${version}   `
  const width = inner.length
  const lines = []
  lines.push('')
  lines.push(colors.banner(`  ╭${'─'.repeat(width)}╮`))
  lines.push(colors.banner(`  │`) + `${inner}` + colors.banner(`│`))
  lines.push(colors.banner(`  ╰${'─'.repeat(width)}╯`))
  if (bare) lines.push(colors.dim(`  [bare mode]`))
  lines.push(colors.dim(`  DB: ${dbPath}`))
  lines.push('')
  return lines.join('\n')
}

export function printProviderBanner(provider, wireModel, endpoint) {
  const lines = []
  lines.push(`  ${colors.key('Provider:')} ${colors.provider(provider)}`)
  lines.push(`  ${colors.key('Model:')}    ${colors.model(wireModel)}`)
  lines.push(`  ${colors.key('Endpoint:')} ${colors.endpoint(endpoint)}`)
  lines.push('')
  return lines.join('\n')
}

// ── Prompt ──────────────────────────────────────────────────

export function formatPrompt() {
  return colors.promptArrow('❯ ')
}

// ── Help ────────────────────────────────────────────────────

export function formatHelp(provider, dbPath) {
  const cmd = (name, desc) => `  ${colors.command(name.padEnd(18))} ${colors.dim(desc)}`
  const lines = [
    '',
    colors.header('Commands'),
    cmd('/phase', 'Show current SDLC phase'),
    cmd('/plan', 'Show plan status'),
    cmd('/code', 'Implement approved plan'),
    cmd('/test', 'Generate and run tests'),
    cmd('/verify', 'Coverage report'),
    cmd('/done', 'Complete workflow'),
    '',
    cmd('/init', 'Create Ona.md'),
    cmd('/diff', 'Uncommitted changes'),
    cmd('/cost', 'Token usage and cost'),
    cmd('/doctor', 'Environment diagnostics'),
    cmd('/permissions', 'Permission rules'),
    cmd('/pr-comments', 'PR comments (requires gh)'),
    cmd('/compact', 'Compact conversation'),
    cmd('/team', 'Manage teams'),
    '',
    cmd('/model [name]', 'Change model'),
    cmd('/login', 'Store credentials'),
    cmd('/logout', 'Clear credentials'),
    cmd('/status', 'Auth status'),
    cmd('/config', 'Show settings'),
    cmd('/clear', 'New conversation'),
    cmd('/exit', 'Quit (/quit)'),
    '',
    `  ${colors.key('Provider:')} ${colors.provider(provider)}`,
    `  ${colors.key('DB:')}       ${colors.dim(dbPath)}`,
    '',
  ]
  return lines.join('\n')
}

// ── Tool display ────────────────────────────────────────────

export function formatToolStart(toolName) {
  return colors.toolLabel('  ┌ ') + colors.toolName(toolName)
}

export function formatToolResult(toolName, content, isError) {
  const icon = isError ? colors.toolError('✗') : colors.success('✓')
  const label = colors.toolLabel('  └ ')
  const preview = (content || '').split('\n')[0].slice(0, 80)
  return label + icon + ' ' + colors.dim(preview)
}

// ── Spinner ─────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export class Spinner {
  constructor(io) {
    this.io = io
    this.frame = 0
    this.interval = null
    this.active = false
    this.message = 'Thinking'
  }

  start(message) {
    if (this.active) return
    this.active = true
    this.message = message || 'Thinking'
    this.frame = 0
    this.interval = setInterval(() => {
      const f = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length]
      this.io.write(`\r${colors.dim(f + ' ' + this.message + '...')}`)
      this.frame++
    }, 80)
  }

  stop() {
    if (!this.active) return
    this.active = false
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.io.write('\r' + ' '.repeat(this.message.length + 20) + '\r')
  }
}

// ── Model change ────────────────────────────────────────────

export function formatModelChange(provider, modelId, wireModel) {
  return `  ${colors.success('✓')} Model: ${colors.provider(provider)} ${colors.dim('/')} ${colors.model(wireModel)}`
}

// ── Status ──────────────────────────────────────────────────

export function formatStatus(status) {
  const lines = ['', colors.header('Auth Status')]
  for (const [k, v] of Object.entries(status)) {
    if (k === 'alsoConfigured') {
      const ac = v || {}
      if (ac.ignoredHints?.length) {
        lines.push(`  ${colors.key('Notes:')}`)
        for (const hint of ac.ignoredHints) lines.push(`    ${colors.dim(hint)}`)
      }
      continue
    }
    const display = typeof v === 'object' ? JSON.stringify(v) : String(v)
    lines.push(`  ${colors.key(k + ':')} ${colors.value(display)}`)
  }
  lines.push('')
  return lines.join('\n')
}

// ── Config ──────────────────────────────────────────────────

export function formatConfig(settings) {
  const lines = ['', colors.header('Settings')]
  const json = JSON.stringify(settings, null, 2)
  for (const line of json.split('\n')) {
    lines.push('  ' + colors.dim(line))
  }
  lines.push('')
  return lines.join('\n')
}

// ── Separator ───────────────────────────────────────────────

export function separator() {
  return colors.separator('─'.repeat(60))
}
