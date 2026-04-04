import { spawn } from 'node:child_process'

const MCP_TIMEOUT = 120_000
const servers = new Map()

/** Start an MCP server from config. Returns a handle with request(). */
export function getMcpServer(name, config) {
  if (servers.has(name)) return servers.get(name)
  const handle = startMcpServer(name, config)
  servers.set(name, handle)
  return handle
}

function startMcpServer(name, config) {
  const cmd = config.command
  const args = config.args || []
  const env = { ...process.env, ...(config.env || {}) }

  let child = null
  let reqId = 1
  let pending = new Map()
  let buffer = ''
  let initialized = false
  let initPromise = null

  function ensureChild() {
    if (child && !child.killed) return
    child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          if (msg.id != null && pending.has(msg.id)) {
            const { resolve } = pending.get(msg.id)
            pending.delete(msg.id)
            resolve(msg)
          }
        } catch { /* skip non-JSON */ }
      }
    })
    child.on('error', () => { child = null })
    child.on('close', () => { child = null; for (const [, p] of pending) p.resolve({ error: { code: -1, message: 'MCP server closed' } }); pending.clear() })
  }

  function sendRequest(method, params, timeoutMs = MCP_TIMEOUT) {
    ensureChild()
    const id = reqId++
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n'
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({ error: { code: -32000, message: 'MCP request timeout' } })
      }, timeoutMs)
      pending.set(id, { resolve: (resp) => { clearTimeout(timer); resolve(resp) } })
      try { child.stdin.write(msg, 'utf8') } catch (e) { clearTimeout(timer); pending.delete(id); resolve({ error: { code: -1, message: String(e) } }) }
    })
  }

  async function initialize() {
    if (initialized) return
    if (initPromise) return initPromise
    initPromise = sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ona-sdlc-repl', version: '0.2.0' },
    }).then(resp => {
      if (!resp.error) {
        sendRequest('notifications/initialized', {}).catch(() => {})
        initialized = true
      }
    })
    return initPromise
  }

  return {
    name,
    async request(method, params, timeoutMs) {
      await initialize()
      return sendRequest(method, params, timeoutMs)
    },
    close() {
      if (child && !child.killed) { try { child.kill() } catch {} }
      servers.delete(name)
    },
  }
}

export function listMcpServers(settings) {
  const srvs = settings?.mcp_servers || {}
  return Object.keys(srvs)
}

export async function mcpListResources(server) {
  const resp = await server.request('resources/list', {})
  if (resp.error) return { content: `MCP error: ${resp.error.message}`, is_error: true }
  return { content: JSON.stringify(resp.result?.resources || [], null, 2), is_error: false }
}

export async function mcpReadResource(server, uri) {
  const resp = await server.request('resources/read', { uri })
  if (resp.error) return { content: `MCP error: ${resp.error.message}`, is_error: true }
  const contents = resp.result?.contents || []
  const text = contents.map(c => c.text || `[blob: ${c.uri}]`).join('\n')
  return { content: text || '(empty)', is_error: false }
}

export async function mcpCallTool(server, toolName, args) {
  const resp = await server.request('tools/call', { name: toolName, arguments: args })
  if (resp.error) return { content: `MCP error: ${resp.error.message}`, is_error: true }
  const result = resp.result
  const text = Array.isArray(result?.content) ? result.content.map(c => c.text || JSON.stringify(c)).join('\n') : JSON.stringify(result)
  return { content: text, is_error: Boolean(result?.isError) }
}

export function closeAllMcpServers() {
  for (const [, s] of servers) s.close()
}
