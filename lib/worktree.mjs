import path from 'node:path'
import { spawnSync } from 'node:child_process'

let currentWorktree = null // { originalCwd, worktreePath, worktreeBranch, name }

const SLUG_RE = /^[a-zA-Z0-9._-]{1,64}$/

export function getCurrentWorktree() { return currentWorktree }

export function createWorktree(cwd, name) {
  if (!name || !SLUG_RE.test(name)) {
    return { ok: false, error: `Invalid worktree name: "${name}". Use alphanumeric, dots, dashes, underscores (max 64 chars).` }
  }
  if (currentWorktree) {
    return { ok: false, error: `Already in worktree: ${currentWorktree.name}. Exit first.` }
  }

  // Find git root
  const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' })
  if (root.status !== 0) return { ok: false, error: 'Not in a git repository.' }
  const gitRoot = root.stdout.trim()

  // Get current branch
  const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: gitRoot, encoding: 'utf8' })
  const baseBranch = branch.stdout?.trim() || 'HEAD'

  // Create worktree
  const wtPath = path.join(gitRoot, '.ona', 'worktrees', name)
  const wtBranch = `worktree-${name.replace(/\//g, '+')}`
  const result = spawnSync('git', ['worktree', 'add', '-B', wtBranch, wtPath, baseBranch], { cwd: gitRoot, encoding: 'utf8' })
  if (result.status !== 0) {
    return { ok: false, error: `git worktree add failed: ${(result.stderr || result.stdout || '').trim()}` }
  }

  currentWorktree = { originalCwd: cwd, worktreePath: wtPath, worktreeBranch: wtBranch, name }
  return { ok: true, worktreePath: wtPath, worktreeBranch: wtBranch }
}

export function removeWorktree() {
  if (!currentWorktree) return { ok: false, error: 'Not in a worktree.' }

  const { worktreePath, worktreeBranch, originalCwd } = currentWorktree

  // Remove worktree
  const rm = spawnSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: originalCwd, encoding: 'utf8' })
  if (rm.status !== 0) {
    return { ok: false, error: `git worktree remove failed: ${(rm.stderr || '').trim()}` }
  }

  // Delete branch
  spawnSync('git', ['branch', '-D', worktreeBranch], { cwd: originalCwd, encoding: 'utf8' })

  const result = { ok: true, originalCwd, removedPath: worktreePath }
  currentWorktree = null
  return result
}
