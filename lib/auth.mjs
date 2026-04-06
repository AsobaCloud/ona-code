import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { secureAuthPath } from './paths.mjs'

function nonempty(s) {
  if (typeof s !== 'string') return ''
  const t = s.trim()
  return t.length ? t : ''
}

export function getAuthPreference() {
  const v = nonempty(process.env.ONA_AUTH_PREFERENCE).toLowerCase()
  if (v === 'subscription' || v === 'oauth' || v === 'bearer') return 'subscription'
  if (v === 'api_key' || v === 'console' || v === 'key') return 'api_key'
  return 'auto'
}

/** §2.7 — Anthropic credential resolution (no secrets in SQLite). */
export function resolveAnthropicCredentials(ctx) {
  const { bareMode = false, apiKeyHelper = null } = ctx
  const pref = getAuthPreference()

  if (bareMode) {
    const key = nonempty(process.env.ANTHROPIC_API_KEY)
    if (key) return { mode: 'api_key', secret: key, source: 'ANTHROPIC_API_KEY', bare: true }
    if (apiKeyHelper) {
      const h = runApiKeyHelper(apiKeyHelper)
      if (h) return { mode: 'api_key', secret: h, source: 'apiKeyHelper', bare: true }
    }
    return { mode: 'none', source: 'none', bare: true }
  }

  const envBearer = envBearerWithSource()
  const envKey = nonempty(process.env.ANTHROPIC_API_KEY)
  const fileCred = readSecureAuthFile()

  if (pref === 'subscription') {
    if (envBearer.token) return { mode: 'bearer', secret: envBearer.token, source: envBearer.source, bare: false }
    if (fileCred?.bearerToken) return { mode: 'bearer', secret: fileCred.bearerToken, source: 'secure_file_bearer', bare: false }
    return { mode: 'none', source: 'none_subscription_preference', bare: false }
  }

  if (pref === 'api_key') {
    if (envKey) return { mode: 'api_key', secret: envKey, source: 'ANTHROPIC_API_KEY', bare: false }
    if (fileCred?.apiKey) return { mode: 'api_key', secret: fileCred.apiKey, source: 'secure_file_api_key', bare: false }
    if (apiKeyHelper) {
      const h = runApiKeyHelper(apiKeyHelper)
      if (h) return { mode: 'api_key', secret: h, source: 'apiKeyHelper', bare: false }
    }
    return { mode: 'none', source: 'none_api_key_preference', bare: false }
  }

  // auto: bearer env → API key env → secure file bearer → secure file API key → claude code keychain → helper
  if (envBearer.token) return { mode: 'bearer', secret: envBearer.token, source: envBearer.source, bare: false }
  if (envKey) return { mode: 'api_key', secret: envKey, source: 'ANTHROPIC_API_KEY', bare: false }
  if (fileCred?.bearerToken) return { mode: 'bearer', secret: fileCred.bearerToken, source: 'secure_file_bearer', bare: false }
  if (fileCred?.apiKey) return { mode: 'api_key', secret: fileCred.apiKey, source: 'secure_file_api_key', bare: false }
  // Try Claude Code's existing OAuth credentials (keychain or plaintext)
  const ccToken = readClaudeCodeOAuthToken()
  if (ccToken) return { mode: 'bearer', secret: ccToken, source: 'claude_code_oauth', bare: false }
  if (apiKeyHelper) {
    const h = runApiKeyHelper(apiKeyHelper)
    if (h) return { mode: 'api_key', secret: h, source: 'apiKeyHelper', bare: false }
  }
  return { mode: 'none', source: 'none', bare: false }
}

function envBearerWithSource() {
  const a = nonempty(process.env.ANTHROPIC_AUTH_TOKEN)
  if (a) return { token: a, source: 'ANTHROPIC_AUTH_TOKEN' }
  const c = nonempty(process.env.CLAUDE_CODE_OAUTH_TOKEN)
  if (c) return { token: c, source: 'CLAUDE_CODE_OAUTH_TOKEN' }
  return { token: '', source: '' }
}

export function authStatusSummary(ctx) {
  const pref = getAuthPreference()
  const c = resolveAnthropicCredentials(ctx)
  const also = computeAlsoConfiguredHints(c, pref)
  if (c.mode === 'none') {
    return { ok: false, kind: 'none', source: c.source, preference: pref, oauth_beta_header: false, alsoConfigured: also }
  }
  const subscriptionStyle = c.mode === 'bearer'
  return { ok: true, kind: subscriptionStyle ? 'oauth_bearer' : 'api_key', source: c.source, preference: pref, oauth_beta_header: subscriptionStyle, alsoConfigured: also }
}

function computeAlsoConfiguredHints(active, pref) {
  const envBearer = !!(nonempty(process.env.ANTHROPIC_AUTH_TOKEN) || nonempty(process.env.CLAUDE_CODE_OAUTH_TOKEN))
  const envKey = !!nonempty(process.env.ANTHROPIC_API_KEY)
  const file = readSecureAuthFile()
  const fileB = !!file?.bearerToken
  const fileK = !!file?.apiKey
  const ignored = []
  if (active.mode === 'bearer') {
    if (envKey) ignored.push('ANTHROPIC_API_KEY in env (export ONA_AUTH_PREFERENCE=api_key to prefer it)')
    if (fileK) ignored.push('apiKey in ~/.ona/secure (not used while bearer wins)')
  }
  if (active.mode === 'api_key') {
    if (envBearer) ignored.push('bearer env vars present but not chosen')
    if (fileB) ignored.push('bearer in ~/.ona/secure (not used while API key wins)')
  }
  if (active.mode === 'none') {
    if (pref === 'subscription' && (envKey || fileK)) ignored.push('API key present but ONA_AUTH_PREFERENCE=subscription requires a bearer token')
    if (pref === 'api_key' && (envBearer || fileB)) ignored.push('Bearer token present but ONA_AUTH_PREFERENCE=api_key ignores it')
  }
  return { envBearer, envApiKey: envKey, secureFileBearer: fileB, secureFileApiKey: fileK, ignoredHints: ignored }
}

export function saveSecureCredentials({ apiKey, bearerToken }) {
  const p = secureAuthPath()
  const prev = readSecureAuthFile() || {}
  const next = { ...prev }
  if (apiKey !== undefined) { if (apiKey === '') delete next.apiKey; else next.apiKey = apiKey }
  if (bearerToken !== undefined) { if (bearerToken === '') delete next.bearerToken; else next.bearerToken = bearerToken }
  fs.writeFileSync(p, JSON.stringify(next, null, 0), { mode: 0o600 })
}

export function clearSecureCredentials() {
  try { fs.unlinkSync(secureAuthPath()) } catch { /* ignore */ }
}

function readSecureAuthFile() {
  try {
    const raw = fs.readFileSync(secureAuthPath(), 'utf8')
    const j = JSON.parse(raw)
    return { apiKey: nonempty(j.apiKey), bearerToken: nonempty(j.bearerToken) }
  } catch { return null }
}

/** Read OAuth token from Claude Code's secure storage (keychain or ~/.claude/.credentials.json). */
function readClaudeCodeOAuthToken() {
  // Try macOS Keychain first
  if (process.platform === 'darwin') {
    try {
      const username = nonempty(process.env.USER) || require('os').userInfo().username
      const r = spawnSync('security', ['find-generic-password', '-a', username, '-w', '-s', 'Claude Code-credentials'], { encoding: 'utf8', timeout: 5000 })
      if (!r.error && r.status === 0 && r.stdout) {
        const data = JSON.parse(r.stdout.trim())
        const token = nonempty(data?.claudeAiOauth?.accessToken)
        if (token) return token
      }
    } catch { /* fall through to plaintext */ }
  }
  // Try plaintext fallback at ~/.claude/.credentials.json
  try {
    const home = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '', '.claude')
    const raw = fs.readFileSync(path.join(home, '.credentials.json'), 'utf8')
    const data = JSON.parse(raw)
    return nonempty(data?.claudeAiOauth?.accessToken) || ''
  } catch { return '' }
}

function runApiKeyHelper(cmd) {
  if (!cmd || typeof cmd !== 'string') return ''
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8', timeout: 30_000 })
  if (r.error || r.status !== 0) return ''
  return nonempty(r.stdout || '')
}

/** §2.7 A3 — Browser PKCE OAuth flow. */
export async function interactiveOAuthLogin(io) {
  const authUrl = process.env.ANTHROPIC_OAUTH_AUTHORIZATION_URL || 'https://console.anthropic.com/oauth/authorize'
  const tokenUrl = process.env.ANTHROPIC_OAUTH_TOKEN_URL || 'https://console.anthropic.com/oauth/token'
  const clientId = process.env.ANTHROPIC_OAUTH_CLIENT_ID || 'ona-sdlc-repl'

  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('hex')

  const server = http.createServer()
  const port = await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
    server.on('error', reject)
  })

  const redirectUri = `http://127.0.0.1:${port}/callback`
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'user:inference',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })

  const fullUrl = `${authUrl}?${params}`
  io.println(`Open this URL in your browser to authenticate:\n${fullUrl}`)

  try {
    const { exec } = await import('node:child_process')
    const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
    exec(`${openCmd} "${fullUrl}"`)
  } catch { /* user will open manually */ }

  io.println('Waiting for OAuth callback...')

  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { server.close(); reject(new Error('OAuth timeout (120s)')) }, 120_000)
    server.on('request', (req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${port}`)
      if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return }
      const returnedState = u.searchParams.get('state')
      const returnedCode = u.searchParams.get('code')
      const err = u.searchParams.get('error')
      if (err) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<h1>Authentication failed</h1><p>You can close this tab.</p>')
        clearTimeout(timeout); server.close(); reject(new Error(`OAuth error: ${err}`)); return
      }
      if (returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<h1>State mismatch</h1>'); clearTimeout(timeout); server.close(); reject(new Error('State mismatch')); return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<h1>Authentication successful</h1><p>You can close this tab and return to ona.</p>')
      clearTimeout(timeout); server.close(); resolve(returnedCode)
    })
  })

  const tokenResp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    }),
  })

  if (!tokenResp.ok) {
    const txt = await tokenResp.text()
    throw new Error(`Token exchange failed (${tokenResp.status}): ${txt.slice(0, 500)}`)
  }

  const tokenData = await tokenResp.json()
  const accessToken = tokenData.access_token
  if (!accessToken) throw new Error('No access_token in token response')

  saveSecureCredentials({ bearerToken: accessToken })
  io.println('OAuth login successful. Bearer token saved to secure storage.')
}
