/** §5.12 — permission evaluation (deny > ask > allow > defaultMode). */
export function evaluatePermission(permissions, toolName, _toolInput) {
  const p = permissions || { defaultMode: 'default' }
  const defaultMode = p.defaultMode || 'default'

  if (matchesAny(p.deny, toolName)) return 'deny'
  if (matchesAny(p.ask, toolName)) return 'ask'
  if (matchesAny(p.allow, toolName)) return 'allow'

  switch (defaultMode) {
    case 'bypassPermissions': return 'allow'
    case 'dontAsk': return 'deny'
    case 'acceptEdits':
      return (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') ? 'allow' : 'ask'
    case 'plan':
      return (toolName === 'Write' || toolName === 'Edit' || toolName === 'Bash' || toolName === 'NotebookEdit') ? 'deny' : 'ask'
    case 'default':
    default:
      return 'ask'
  }
}

function matchesAny(rules, toolName) {
  if (!Array.isArray(rules)) return false
  for (const r of rules) {
    if (typeof r !== 'string' || !r.trim()) continue
    if (ruleMatches(r.trim(), toolName)) return true
  }
  return false
}

function ruleMatches(rule, toolName) {
  if (rule === toolName) return true
  if (rule.endsWith('*')) return toolName.startsWith(rule.slice(0, -1))
  return false
}
