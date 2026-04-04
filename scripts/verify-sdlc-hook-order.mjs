#!/usr/bin/env node
import { HOOK_INPUT_SCHEMA_UNION_ORDER } from '../lib/hookShapeOrder.mjs'

const SPEC_ORDER = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionDenied',
  'Notification', 'UserPromptSubmit', 'SessionStart', 'SessionEnd',
  'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop',
  'PreCompact', 'PostCompact', 'PermissionRequest', 'Setup',
  'TeammateIdle', 'TaskCreated', 'TaskCompleted',
  'Elicitation', 'ElicitationResult', 'ConfigChange', 'InstructionsLoaded',
  'WorktreeCreate', 'WorktreeRemove', 'CwdChanged', 'FileChanged',
]

if (HOOK_INPUT_SCHEMA_UNION_ORDER.length !== SPEC_ORDER.length) {
  console.error(`Length mismatch: runtime=${HOOK_INPUT_SCHEMA_UNION_ORDER.length} spec=${SPEC_ORDER.length}`)
  process.exit(1)
}

for (let i = 0; i < SPEC_ORDER.length; i++) {
  if (HOOK_INPUT_SCHEMA_UNION_ORDER[i] !== SPEC_ORDER[i]) {
    console.error(`Mismatch at ${i}: runtime=${HOOK_INPUT_SCHEMA_UNION_ORDER[i]} spec=${SPEC_ORDER[i]}`)
    process.exit(1)
  }
}

console.log(`verify-sdlc-hook-order: OK (${SPEC_ORDER.length} union members)`)
