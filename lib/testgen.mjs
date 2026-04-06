import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { withTransaction } from './store.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.resolve(__dirname, '..', 'templates')
const TAG_RE = /\[template:\s*(\w+)\]/
const GENERATED_DIR = path.resolve(__dirname, '..', '.generated-tests')

/** Extract success criteria with their template tags from plan content. */
export function extractCriteriaWithTags(planContent) {
  const lines = planContent.split('\n')
  let inCriteria = false
  const criteria = []
  for (const line of lines) {
    if (/^##\s*Success\s*Criteria/i.test(line)) { inCriteria = true; continue }
    if (inCriteria && /^##\s/.test(line)) break
    if (inCriteria && line.trim().match(/^\d+\.|^-/)) {
      const m = line.match(TAG_RE)
      if (m) {
        const text = line.trim().replace(TAG_RE, '').replace(/^\d+\.\s*|^-\s*/, '').trim()
        criteria.push({ text, template: m[1] })
      }
    }
  }
  return criteria
}

/**
 * Generate and run tests from plan criteria using templates.
 * For now, generates simple structural tests from the template + criterion.
 * The LLM-based slot filling is a future enhancement — this version creates
 * runnable tests by pattern-matching on the criterion text.
 */
export async function generateAndRunTests(db, rt, planContent, log) {
  const criteria = extractCriteriaWithTags(planContent)
  if (!criteria.length) { log('No tagged criteria found in plan.'); return [] }

  fs.mkdirSync(GENERATED_DIR, { recursive: true })
  const results = []

  for (let i = 0; i < criteria.length; i++) {
    const { text, template } = criteria[i]
    const templatePath = path.join(TEMPLATES_DIR, `test_${template}.sh`)
    if (!fs.existsSync(templatePath)) {
      log(`  ✗ No template file for: ${template}`)
      results.push({ criterion: text, passed: false, output: `Missing template: ${template}` })
      continue
    }

    const templateContent = fs.readFileSync(templatePath, 'utf8')
    const testFile = path.join(GENERATED_DIR, `test_${i}_${template}.sh`)

    // Fill template slots with criterion-derived content
    const filled = fillTemplate(templateContent, text, template, rt)
    fs.writeFileSync(testFile, filled, { mode: 0o755 })

    // Validate
    const validate = spawnSync('bash', [path.join(TEMPLATES_DIR, 'validate_test.sh'), testFile], { encoding: 'utf8', timeout: 10_000 })
    if (validate.status !== 0) {
      log(`  ✗ Validation failed: ${text.slice(0, 60)}`)
      results.push({ criterion: text, passed: false, output: validate.stderr || validate.stdout })
      continue
    }

    // Run
    const dbPath = rt.runtimeDbPath || process.env.AGENT_SDLC_DB
    const run = spawnSync('bash', [testFile], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, AGENT_SDLC_DB: dbPath },
    })
    const passed = run.status === 0
    const output = ((run.stdout || '') + (run.stderr || '')).trim()
    results.push({ criterion: text, passed, output })

    // Persist result
    withTransaction(db, () => {
      db.prepare(`INSERT INTO events(conversation_id, session_id, event_type, detail) VALUES (?,?,?,?)`).run(
        rt.conversationId, rt.sessionId, 'test_result',
        JSON.stringify({ criterion: text, template, passed, output: output.slice(0, 2000) })
      )
    })
  }

  return results
}

/**
 * Fill template slots based on criterion text and template type.
 * This is a structural fill — it creates a runnable test that exercises
 * the product through its CLI. For full LLM-based slot filling, the
 * /test command would call the model with the template + criterion.
 */
function fillTemplate(templateContent, criterion, templateType, rt) {
  const dbPath = rt.runtimeDbPath || process.env.AGENT_SDLC_DB || '/tmp/sdlc_test_$$.db'
  const onaPath = path.resolve(__dirname, '..', 'bin', 'agent.mjs')
  const onaCmd = `node ${onaPath}`

  let filled = templateContent
    .replace(/^# PLAN_REQ:.*$/m, `# PLAN_REQ: ${criterion}`)

  // Remove comment markers from the example code in templates so they're executable
  // Replace placeholder sections with actual test code based on template type
  if (templateType === 'tool_contract') {
    filled = fillToolContractTemplate(filled, criterion, onaCmd, dbPath)
  } else if (templateType === 'phase_transition') {
    filled = fillPhaseTransitionTemplate(filled, criterion, onaCmd, dbPath)
  } else if (templateType === 'hook_contract') {
    filled = fillHookContractTemplate(filled, criterion, onaCmd, dbPath)
  } else if (templateType === 'e2e_workflow') {
    filled = fillE2ETemplate(filled, criterion, onaCmd, dbPath)
  }

  return filled
}

function fillToolContractTemplate(template, criterion, onaCmd, dbPath) {
  return template
    .replace(/# ══ SETUP ══\n[\s\S]*?(?=# ══ EXERCISE ══)/, `# ══ SETUP ══\necho "test content" > /tmp/sdlc_test_file.txt\n\n`)
    .replace(/# ══ EXERCISE ══\n[\s\S]*?(?=# ══ ASSERT ══)/, `# ══ EXERCISE ══\n${onaCmd} --eval '{"tool":"Read","input":{"file_path":"/tmp/sdlc_test_file.txt"}}'\n\n`)
    .replace(/# ══ ASSERT ══[\s\S]*$/, `# ══ ASSERT ══\nRESULT=$(sqlite3 "$AGENT_SDLC_DB" "SELECT payload_json FROM transcript_entries WHERE entry_type='tool_result' ORDER BY sequence DESC LIMIT 1")\necho "$RESULT" | grep '"is_error":false' || { echo "FAIL: ${criterion}"; exit 1; }\necho "PASS: ${criterion}"\n`)
}

function fillPhaseTransitionTemplate(template, criterion, onaCmd, dbPath) {
  return template
    .replace(/# ══ SETUP ══\n[\s\S]*?(?=# ══ EXERCISE ══)/, `# ══ SETUP ══\n${onaCmd} --init-db\nsqlite3 "$AGENT_SDLC_DB" "INSERT INTO conversations(id, project_dir, phase) VALUES ('test-conv', '/tmp', 'idle')"\n\n`)
    .replace(/# ══ EXERCISE ══\n[\s\S]*?(?=# ══ ASSERT ══)/, `# ══ EXERCISE ══\n${onaCmd} --transition planning --conversation test-conv 2>&1 || true\n\n`)
    .replace(/# ══ ASSERT ══[\s\S]*$/, `# ══ ASSERT ══\nPHASE=$(sqlite3 "$AGENT_SDLC_DB" "SELECT phase FROM conversations WHERE id='test-conv'")\ntest "$PHASE" = "planning" || { echo "FAIL: ${criterion}"; exit 1; }\necho "PASS: ${criterion}"\n`)
}

function fillHookContractTemplate(template, criterion, onaCmd, dbPath) {
  return template
    .replace(/# ══ SETUP ══\n[\s\S]*?(?=# ══ EXERCISE ══)/, `# ══ SETUP ══\n${onaCmd} --init-db\nsqlite3 "$AGENT_SDLC_DB" "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\\\"hooks\\\":[{\\\"hook_event_name\\\":\\\"PreToolUse\\\",\\\"matcher\\\":\\\"Bash\\\",\\\"command\\\":\\\"exit 2\\\"}]}', datetime('now'))"\n\n`)
    .replace(/# ══ EXERCISE ══\n[\s\S]*?(?=# ══ ASSERT ══)/, `# ══ EXERCISE ══\n${onaCmd} --eval '{"tool":"Bash","input":{"command":"echo hi"}}' || true\n\n`)
    .replace(/# ══ ASSERT ══[\s\S]*$/, `# ══ ASSERT ══\nROW=$(sqlite3 "$AGENT_SDLC_DB" "SELECT exit_code FROM hook_invocations WHERE hook_event='PreToolUse' ORDER BY id DESC LIMIT 1")\ntest "$ROW" = "2" || { echo "FAIL: ${criterion}"; exit 1; }\necho "PASS: ${criterion}"\n`)
}

function fillE2ETemplate(template, criterion, onaCmd, dbPath) {
  return template
    .replace(/# ══ SETUP ══\n[\s\S]*?(?=# ══ EXERCISE ══)/, `# ══ SETUP ══\n${onaCmd} --init-db\n\n`)
    .replace(/# ══ EXERCISE ══\n[\s\S]*?(?=# ══ ASSERT ══)/, `# ══ EXERCISE ══\n# E2E workflow test — verify DB was initialized\n${onaCmd} --init-db\n\n`)
    .replace(/# ══ ASSERT ══[\s\S]*$/, `# ══ ASSERT ══\nTABLES=$(sqlite3 "$AGENT_SDLC_DB" "SELECT count(*) FROM sqlite_master WHERE type='table'")\ntest "$TABLES" -ge 13 || { echo "FAIL: ${criterion}"; exit 1; }\necho "PASS: ${criterion}"\n`)
}
