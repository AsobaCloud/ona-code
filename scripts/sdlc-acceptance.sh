#!/usr/bin/env bash
set -euo pipefail

# CLEAN_ROOM_SPEC Appendix F — sdlc-acceptance.sh
# Exits 0 iff ALL rows PASS; non-zero on first FAIL.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_PATH="${AGENT_SDLC_DB:-/tmp/ona_acceptance_test_$$.db}"
export AGENT_SDLC_DB="$DB_PATH"

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1" >&2; exit 1; }

run_check() {
  local row_id="$1"; shift
  if "$@"; then
    pass "$row_id"
  else
    fail "$row_id"
  fi
}

cleanup() { rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm" 2>/dev/null || true; }
trap cleanup EXIT

echo "=== ona SDLC acceptance tests ==="
echo "DB: $DB_PATH"

# ── ROW-01: DDL tables present (§4.3) ──
echo "[ROW-01] DDL tables"
run_check "ROW-01" node -e "
import { openStore } from '$ROOT/lib/store.mjs'
const db = openStore('$DB_PATH')
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all().map(r => r.name)
const required = ['schema_meta','conversations','sessions','state','plans','summaries','events','task_ratings','memories','transcript_entries','hook_invocations','tool_permission_log','settings_snapshot']
for (const t of required) { if (!tables.includes(t)) { console.error('Missing table: ' + t); process.exit(1) } }
console.log('All ' + required.length + ' tables present')
"

# ── ROW-02: Hook order verification (§3, Appendix A) ──
echo "[ROW-02] Hook order"
run_check "ROW-02" node "$ROOT/scripts/verify-sdlc-hook-order.mjs"

# ── ROW-03: Schema version (§4.2) ──
echo "[ROW-03] Schema version"
run_check "ROW-03" node -e "
import { openStore } from '$ROOT/lib/store.mjs'
const db = openStore('$DB_PATH')
const r = db.prepare(\"SELECT value FROM schema_meta WHERE key = 'schema_version'\").get()
if (!r || r.value !== '1') { console.error('schema_version missing or wrong'); process.exit(1) }
console.log('schema_version = 1')
"

# ── ROW-04: All 21 tools have definitions (§7.2) ──
echo "[ROW-04] Tool definitions"
run_check "ROW-04" node -e "
import { anthropicToolDefinitions } from '$ROOT/lib/tools.mjs'
const defs = anthropicToolDefinitions()
const required = ['Read','Write','Edit','Glob','Grep','Bash','NotebookEdit','WebFetch','WebSearch','AskUserQuestion','Brief','TodoWrite','TaskOutput','TaskStop','EnterPlanMode','ExitPlanMode','Agent','Skill','ToolSearch','ListMcpResources','ReadMcpResource']
const names = defs.map(d => d.name)
for (const t of required) { if (!names.includes(t)) { console.error('Missing tool def: ' + t); process.exit(1) } }
console.log('All ' + required.length + ' tool definitions present')
"

# ── ROW-05: Tool dispatch — no 'not implemented' (§0.3, §7.2) ──
echo "[ROW-05] No stub tools"
run_check "ROW-05" node -e "
import { openStore } from '$ROOT/lib/store.mjs'
import { executeBuiltinTool } from '$ROOT/lib/tools.mjs'
const db = openStore('$DB_PATH')
const convId = 'test-conv-05'
const sessId = 'test-sess-05'
db.prepare(\"INSERT INTO conversations(id, project_dir, phase) VALUES (?,?,'idle')\").run(convId, '/tmp')
db.prepare('INSERT INTO sessions(session_id, conversation_id) VALUES (?,?)').run(sessId, convId)
const ctx = { sessionId: sessId, conversationId: convId, cwd: '/tmp', settings: {} }
const io = { write: ()=>{}, println: ()=>{}, ask: ()=>Promise.resolve('n') }
const tools = ['Read','Write','Edit','Glob','Grep','Bash','NotebookEdit','WebFetch','WebSearch','Brief','TodoWrite','TaskOutput','TaskStop','EnterPlanMode','ExitPlanMode','Skill','ToolSearch','ListMcpResources','ReadMcpResource']
for (const t of tools) {
  const r = await executeBuiltinTool(db, ctx, t, {}, io)
  if (r.content.includes('not implemented') || r.content.includes('Unknown tool')) {
    console.error('Stub/unknown tool: ' + t + ' => ' + r.content); process.exit(1)
  }
}
console.log('No stub tools detected (' + tools.length + ' checked)')
"

# ── ROW-06: Provider wire models (§2.2) ──
echo "[ROW-06] Wire models"
run_check "ROW-06" node -e "
import { resolveWireModel } from '$ROOT/lib/modelConfig.mjs'
const tests = [
  { provider: 'claude_code_subscription', model_id: 'claude_sonnet_4', wire: 'claude-sonnet-4-20250514' },
  { provider: 'openai_compatible', model_id: 'gpt_4o', wire: 'gpt-4o' },
]
for (const t of tests) {
  const w = resolveWireModel({ provider: t.provider, model_id: t.model_id })
  if (w !== t.wire) { console.error('Wire mismatch: ' + t.model_id + ' => ' + w + ' (expected ' + t.wire + ')'); process.exit(1) }
}
process.env.LM_STUDIO_MODEL = 'test-model'
const lm = resolveWireModel({ provider: 'lm_studio_local', model_id: 'lm_studio_server_routed' })
if (lm !== 'test-model') { console.error('LM Studio wire mismatch'); process.exit(1) }
console.log('All provider wire models correct')
"

# ── ROW-07: Phase transitions (§8.2) ──
echo "[ROW-07] Phase transitions"
run_check "ROW-07" node -e "
import { canTransition } from '$ROOT/lib/workflow.mjs'
import { openStore } from '$ROOT/lib/store.mjs'
const db = openStore('$DB_PATH')
const convId = 'test-conv-07'
db.prepare(\"INSERT INTO conversations(id, project_dir, phase) VALUES (?,?,'implement')\").run(convId, '/tmp')
let r = canTransition(db, convId, 'verify')
if (r.ok) { console.error('implement→verify should be blocked'); process.exit(1) }
r = canTransition(db, convId, 'test')
if (!r.ok) { console.error('implement→test should be allowed'); process.exit(1) }
r = canTransition(db, convId, 'planning')
if (!r.ok) { console.error('implement→planning should be allowed'); process.exit(1) }
console.log('Phase transitions enforce §8.2 gates')
"

# ── ROW-08: Permission evaluation (§5.12) ──
echo "[ROW-08] Permissions"
run_check "ROW-08" node -e "
import { evaluatePermission } from '$ROOT/lib/permissions.mjs'
const p = { defaultMode: 'default', deny: ['Bash'], allow: ['Read'] }
if (evaluatePermission(p, 'Bash', {}) !== 'deny') { process.exit(1) }
if (evaluatePermission(p, 'Read', {}) !== 'allow') { process.exit(1) }
if (evaluatePermission(p, 'Write', {}) !== 'ask') { process.exit(1) }
if (evaluatePermission({ defaultMode: 'bypassPermissions' }, 'Bash', {}) !== 'allow') { process.exit(1) }
if (evaluatePermission({ defaultMode: 'plan' }, 'Bash', {}) !== 'deny') { process.exit(1) }
console.log('Permission evaluation correct')
"

# ── ROW-09: Planning gate (§8.3) ──
echo "[ROW-09] Planning gate"
run_check "ROW-09" node -e "
import { planningGateDeniesTool } from '$ROOT/lib/workflow.mjs'
import { openStore } from '$ROOT/lib/store.mjs'
const db = openStore('$DB_PATH')
const convId = 'test-conv-09'
db.prepare(\"INSERT INTO conversations(id, project_dir, phase) VALUES (?,?,'planning')\").run(convId, '/tmp')
if (!planningGateDeniesTool(db, convId, 'Write')) { console.error('Write should be denied in planning'); process.exit(1) }
if (!planningGateDeniesTool(db, convId, 'Edit')) { console.error('Edit should be denied'); process.exit(1) }
if (!planningGateDeniesTool(db, convId, 'Bash')) { console.error('Bash should be denied'); process.exit(1) }
if (planningGateDeniesTool(db, convId, 'Read')) { console.error('Read should NOT be denied'); process.exit(1) }
console.log('Planning gate correct')
"

# ── ROW-10: No secrets in DB (§2.8) ──
echo "[ROW-10] No secrets in DB"
run_check "ROW-10" node -e "
import { openStore } from '$ROOT/lib/store.mjs'
const db = openStore('$DB_PATH')
const tables = ['settings_snapshot','transcript_entries','hook_invocations','events','state']
for (const t of tables) {
  const rows = db.prepare('SELECT * FROM ' + t).all()
  const dump = JSON.stringify(rows)
  if (/sk-ant-/.test(dump) || /Bearer [A-Za-z0-9]/.test(dump)) {
    console.error('Secret pattern found in ' + t); process.exit(1)
  }
}
console.log('No secret patterns in DB tables')
"

# ── ROW-11: Pragmas (§4.8) ──
echo "[ROW-11] Pragmas"
run_check "ROW-11" node -e "
import { openStore } from '$ROOT/lib/store.mjs'
const db = openStore('$DB_PATH')
const fk = db.pragma('foreign_keys')[0]
const jm = db.pragma('journal_mode')[0]
const bt = db.pragma('busy_timeout')[0]
if (!fk?.foreign_keys) { console.error('foreign_keys not ON'); process.exit(1) }
if (jm?.journal_mode !== 'wal') { console.error('journal_mode not WAL'); process.exit(1) }
if (bt?.timeout !== 30000) { console.error('busy_timeout not 30000: ' + JSON.stringify(bt)); process.exit(1) }
console.log('Pragmas correct')
"

# ── Summary ──
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then exit 1; fi
echo "ALL PASS"
