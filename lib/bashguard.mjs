import path from 'node:path'

/**
 * Validate a bash command before execution.
 * Blocks destructive commands everywhere and filesystem writes outside cwd.
 * Returns { ok: true } or { ok: false, reason: string }.
 */
export function validateBashCommand(cmd, cwd) {
  // Split on pipes, semicolons, &&, || to check each segment
  const segments = cmd.split(/\s*[;|&]{1,2}\s*/).map(s => s.trim()).filter(Boolean)
  for (const seg of segments) {
    const check = checkSegment(seg, cwd)
    if (!check.ok) return check
  }
  // Check subshells $(...) and backticks
  const subshells = [...cmd.matchAll(/\$\(([^)]+)\)/g), ...cmd.matchAll(/`([^`]+)`/g)]
  for (const m of subshells) {
    const check = checkSegment(m[1].trim(), cwd)
    if (!check.ok) return check
  }
  return { ok: true }
}

function checkSegment(seg, cwd) {
  const lower = seg.toLowerCase()
  const tokens = seg.split(/\s+/)

  // ── Category 1: Always-blocked destructive commands ──

  // rm -rf with dangerous targets
  if (/\brm\b/.test(seg) && /-(r|rf|fr)\b/.test(seg)) {
    const rmTargets = tokens.filter(t => !t.startsWith('-') && t !== 'rm')
    for (const t of rmTargets) {
      const resolved = resolvePath(t, cwd)
      if (isDangerousPath(resolved, cwd)) {
        return { ok: false, reason: `rm -rf targeting dangerous path: ${t}` }
      }
    }
  }

  // git destructive operations
  if (/\bgit\s+checkout\s+--/.test(seg)) return { ok: false, reason: 'git checkout -- discards changes (destructive)' }
  if (/\bgit\s+reset\s+--hard/.test(seg)) return { ok: false, reason: 'git reset --hard (destructive)' }
  if (/\bgit\s+push\s+(-f|--force)/.test(seg)) return { ok: false, reason: 'git push --force (destructive)' }
  if (/\bgit\s+clean\s+-[fd]/.test(seg)) return { ok: false, reason: 'git clean (destructive)' }
  if (/\bgit\s+branch\s+-D\b/.test(seg)) return { ok: false, reason: 'git branch -D (destructive)' }
  if (/\bgit\s+stash\s+drop/.test(seg)) return { ok: false, reason: 'git stash drop (destructive)' }
  if (/\bgit\s+reflog\s+expire/.test(seg)) return { ok: false, reason: 'git reflog expire (destructive)' }

  // System-level destructive commands
  if (/\bmkfs\b/.test(lower)) return { ok: false, reason: 'mkfs (destructive)' }
  if (/\bdd\s+if=/.test(lower)) return { ok: false, reason: 'dd (destructive)' }
  if (/\bformat\b/.test(lower) && /\/dev\//.test(seg)) return { ok: false, reason: 'format device (destructive)' }
  if (/\bkillall\b/.test(lower)) return { ok: false, reason: 'killall (destructive)' }
  if (/\bkill\s+-9\b/.test(seg)) return { ok: false, reason: 'kill -9 (destructive)' }
  if (/\bsudo\b/.test(lower)) return { ok: false, reason: 'sudo not permitted' }
  if (/\bsu\s/.test(lower)) return { ok: false, reason: 'su not permitted' }

  // ── Category 2: Filesystem writes outside cwd ──

  // Redirects to absolute paths
  const redirects = [...seg.matchAll(/>{1,2}\s*(\S+)/g)]
  for (const m of redirects) {
    const target = m[1]
    if (target === '/dev/null') continue
    const resolved = resolvePath(target, cwd)
    if (!isUnderCwd(resolved, cwd)) {
      return { ok: false, reason: `Write redirect to path outside working directory: ${target}` }
    }
  }

  // tee to absolute paths outside cwd
  if (/\btee\b/.test(seg)) {
    const teeArgs = tokens.slice(tokens.indexOf('tee') + 1).filter(t => !t.startsWith('-'))
    for (const t of teeArgs) {
      const resolved = resolvePath(t, cwd)
      if (!isUnderCwd(resolved, cwd)) {
        return { ok: false, reason: `tee to path outside working directory: ${t}` }
      }
    }
  }

  // cp, mv, ln with targets outside cwd
  for (const cmd of ['cp', 'mv', 'ln']) {
    if (new RegExp(`\\b${cmd}\\b`).test(seg)) {
      const args = tokens.slice(tokens.indexOf(cmd) + 1).filter(t => !t.startsWith('-'))
      if (args.length >= 2) {
        const target = args[args.length - 1]
        const resolved = resolvePath(target, cwd)
        if (!isUnderCwd(resolved, cwd)) {
          return { ok: false, reason: `${cmd} target outside working directory: ${target}` }
        }
      }
    }
  }

  // mkdir, touch with paths outside cwd
  for (const cmd of ['mkdir', 'touch']) {
    if (new RegExp(`\\b${cmd}\\b`).test(seg)) {
      const args = tokens.slice(tokens.indexOf(cmd) + 1).filter(t => !t.startsWith('-'))
      for (const a of args) {
        const resolved = resolvePath(a, cwd)
        if (!isUnderCwd(resolved, cwd)) {
          return { ok: false, reason: `${cmd} outside working directory: ${a}` }
        }
      }
    }
  }

  // sed -i on files outside cwd
  if (/\bsed\b.*-i/.test(seg)) {
    const sedArgs = tokens.filter(t => !t.startsWith('-') && t !== 'sed' && !t.startsWith('s/') && !t.startsWith("'"))
    for (const a of sedArgs) {
      const resolved = resolvePath(a, cwd)
      if (!isUnderCwd(resolved, cwd)) {
        return { ok: false, reason: `sed -i on file outside working directory: ${a}` }
      }
    }
  }

  // chmod/chown -R with paths outside cwd
  for (const cmd of ['chmod', 'chown']) {
    if (new RegExp(`\\b${cmd}\\b`).test(seg) && /-R/.test(seg)) {
      const args = tokens.filter(t => !t.startsWith('-') && t !== cmd)
      for (const a of args) {
        if (/^[0-7]+$/.test(a) || /^[a-z]+:[a-z]+$/i.test(a)) continue // skip mode/owner args
        const resolved = resolvePath(a, cwd)
        if (!isUnderCwd(resolved, cwd)) {
          return { ok: false, reason: `${cmd} -R outside working directory: ${a}` }
        }
      }
    }
  }

  return { ok: true }
}

function resolvePath(p, cwd) {
  if (!p) return cwd
  if (p.startsWith('~')) p = path.join(process.env.HOME || '/root', p.slice(1))
  if (p.startsWith('/')) return path.resolve(p)
  return path.resolve(cwd, p)
}

function isUnderCwd(resolved, cwd) {
  const normalCwd = path.resolve(cwd) + path.sep
  const normalResolved = path.resolve(resolved)
  return normalResolved === path.resolve(cwd) || normalResolved.startsWith(normalCwd)
}

function isDangerousPath(resolved, cwd) {
  // Paths that are never safe to rm -rf
  const dangerous = ['/', '/home', '/Users', '/tmp', '/var', '/etc', '/usr', '/bin', '/sbin', '/opt', '/System', '/Library']
  if (dangerous.includes(resolved)) return true
  if (resolved === process.env.HOME) return true
  // Outside cwd is dangerous for rm -rf
  if (!isUnderCwd(resolved, cwd)) return true
  return false
}
