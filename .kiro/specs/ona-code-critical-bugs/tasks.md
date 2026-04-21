# Implementation Plan

Every test in this plan is a black-box behavioral test. Tests invoke `ona` through its CLI (`ona --eval`, `ona --init-db`, `ona --transition`), inspect observable outcomes (DB rows via `sqlite3`, files on disk, process exit codes, stdout/stderr), and never import implementation modules or mock internal functions. Tests follow the same pattern as `scripts/sdlc-acceptance.sh`.

A test MUST fail on unfixed code and pass after the fix. If a test passes on unfixed code, it is not testing the bug.

---

- [x] 1. Set up test infrastructure
  - Create `tests/bugs/` directory
  - Create `tests/bugs/run-all.sh`:
    - Sources the same `fresh_db`, `db`, `tool_one`, `write_mock_server` helpers from `scripts/sdlc-acceptance.sh` (or duplicates the minimal subset needed)
    - Iterates over `tests/bugs/bug*.sh`, runs each with `bash`, reports PASS/FAIL per file
    - Exits non-zero if any file fails; prints summary line `N passed, M failed`
  - Add `"test:bugs": "bash tests/bugs/run-all.sh"` to `package.json` scripts
  - Verify `bash tests/bugs/run-all.sh` runs without error (no test files yet = 0 passed, 0 failed, exit 0)
  - _Requirements: all bugs_

---

- [x] 2. Behavioral test — Bug 3: Glob broken for patterns with `.` or `*`
  - **Write test BEFORE fix. Must FAIL on unfixed code.**
  - Create `tests/bugs/bug3_glob_escaping.sh`:
    - SETUP: create `/tmp/bug3_$$/{foo.mjs,bar.ipynb,README.md,src/main.mjs}`
    - EXERCISE: `ona --eval '{"tool":"Glob","input":{"pattern":"*.mjs","path":"/tmp/bug3_$$"}}'`
    - ASSERT: `sqlite3` query on `transcript_entries` for the `tool_result` — content must contain `foo.mjs`; `is_error` must be `false`
    - EXERCISE: `ona --eval '{"tool":"Glob","input":{"pattern":"README.md","path":"/tmp/bug3_$$"}}'`
    - ASSERT: content contains `README.md`
    - EXERCISE: `ona --eval '{"tool":"Glob","input":{"pattern":"*.ipynb","path":"/tmp/bug3_$$"}}'`
    - ASSERT: content contains `bar.ipynb`
    - PRESERVATION: `ona --eval '{"tool":"Glob","input":{"pattern":"src/**","path":"/tmp/bug3_$$"}}'` — content contains `main.mjs` (no special chars, must still work)
    - CLEANUP: `rm -rf /tmp/bug3_$$`
    - **Expected on unfixed code**: all three dot-pattern asserts fail — content is `(no matches)`
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2_

- [x] 3. Fix Bug 3 — `globMatch()` regex escaping (`lib/tools.mjs`)
  - In `globMatch`, change `.replace(/[.+^${}()|[\]\\]/g, '<UUID_STRING>')` to `.replace(/[.+^${}()|[\]\\]/g, '\\$&')`
  - Run `bash tests/bugs/bug3_glob_escaping.sh` — must PASS
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4_

---

- [x] 4. Behavioral test — Bug 8: Write/Edit path traversal outside cwd
  - **Write test BEFORE fix. Must FAIL on unfixed code.**
  - Create `tests/bugs/bug8_path_containment.sh`:
    - SETUP: `mkdir -p /tmp/bug8_cwd_$$`; seed DB in `implement` phase with approved plan (so planning gate allows Write); set `cwd=/tmp/bug8_cwd_$$`
    - **Test 1 — relative traversal Write**:
      - EXERCISE: `ona --eval '{"tool":"Write","input":{"file_path":"../evil_$$.txt","content":"pwned"}}' --cwd /tmp/bug8_cwd_$$`
      - ASSERT: `tool_result` in DB has `is_error:true` and content contains `outside working directory`
      - ASSERT: `test ! -f /tmp/evil_$$.txt` — file must NOT exist on disk
    - **Test 2 — absolute path outside cwd Write**:
      - EXERCISE: `ona --eval '{"tool":"Write","input":{"file_path":"/tmp/evil_abs_$$.txt","content":"pwned"}}' --cwd /tmp/bug8_cwd_$$`
      - ASSERT: `is_error:true`; file `/tmp/evil_abs_$$.txt` does NOT exist
    - **Test 3 — relative traversal Edit**:
      - SETUP: `echo original > /tmp/evil_edit_$$.txt`
      - EXERCISE: `ona --eval '{"tool":"Edit","input":{"file_path":"../evil_edit_$$.txt","old_string":"original","new_string":"hacked"}}' --cwd /tmp/bug8_cwd_$$`
      - ASSERT: `is_error:true`; `grep -q original /tmp/evil_edit_$$.txt` — content unchanged
    - **Preservation — in-cwd Write still works**:
      - EXERCISE: `ona --eval '{"tool":"Write","input":{"file_path":"safe.txt","content":"ok"}}' --cwd /tmp/bug8_cwd_$$`
      - ASSERT: `is_error:false`; `test -f /tmp/bug8_cwd_$$/safe.txt`
    - CLEANUP: `rm -rf /tmp/bug8_cwd_$$ /tmp/evil_$$.txt /tmp/evil_abs_$$.txt /tmp/evil_edit_$$.txt`
    - **Expected on unfixed code**: Tests 1–3 fail — files ARE written/modified outside cwd
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 3.3_

- [x] 5. Fix Bug 8 — Write/Edit path containment (`lib/tools.mjs`)
  - In `toolWrite`, after `const abs = ...`, add: `if (abs !== cwd && !abs.startsWith(cwd + path.sep)) return { content: 'Write: path outside working directory', is_error: true }`
  - In `toolEdit`, same guard: `if (abs !== cwd && !abs.startsWith(cwd + path.sep)) return { content: 'Edit: path outside working directory', is_error: true }`
  - Run `bash tests/bugs/bug8_path_containment.sh` — must PASS
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3_

---

- [x] 6. Behavioral test — Bug 6: ExitPlanMode inserts orphaned draft rows before validation
  - **Write test BEFORE fix. Must FAIL on unfixed code.**
  - Create `tests/bugs/bug6_exitplanmode_orphan.sh`:
    - SETUP: `fresh_db`; seed conversation in `planning` phase
    - Record `COUNT_BEFORE=$(sqlite3 "$AGENT_SDLC_DB" "SELECT COUNT(*) FROM plans WHERE conversation_id='$CONV_ID'")`
    - **Test 1 — plan missing template tags**:
      - EXERCISE: `echo 'n' | ona --eval '{"tool":"ExitPlanMode","input":{"content":"## Plan\n## Success Criteria\n1. Given X When Y Then Z\n"}}'`
      - ASSERT: `tool_result` has `is_error:true`
      - ASSERT: `COUNT_AFTER=$(sqlite3 ...)` equals `COUNT_BEFORE` — no orphaned row
    - **Test 2 — repeated invalid submissions don't accumulate rows**:
      - EXERCISE: call ExitPlanMode 3 more times with invalid plans
      - ASSERT: total plan count still equals `COUNT_BEFORE`
    - **Preservation — valid plan approved by user creates exactly one approved row**:
      - EXERCISE: `echo 'y' | ona --eval '{"tool":"ExitPlanMode","input":{"content":"## Plan\n## Success Criteria\n1. Given X When Y Then Z [template: tool_contract]\n"}}'`
      - ASSERT: `SELECT COUNT(*) FROM plans WHERE status='approved'` equals 1
      - ASSERT: `SELECT phase FROM conversations WHERE id='$CONV_ID'` equals `implement`
    - **Expected on unfixed code**: Test 1 fails — `COUNT_AFTER = COUNT_BEFORE + 1` (draft row inserted before validation)
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

- [x] 7. Fix Bug 6 — ExitPlanMode inserts before validation (`lib/tools.mjs`)
  - In `toolExitPlanMode`, reorder: run `validatePlanTemplateTags` → run `validateGivenWhenThen` → show plan to user → ask approval → only INSERT if approved
  - Remove the `INSERT INTO plans` that currently runs before validation
  - Run `bash tests/bugs/bug6_exitplanmode_orphan.sh` — must PASS
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

---

- [x] 8. Behavioral test — Bug 4: Bash `cd` does not update cwd for subsequent tools
  - **Write test BEFORE fix. Must FAIL on unfixed code.**
  - Create `tests/bugs/bug4_bash_cwd.sh`:
    - SETUP: `mkdir -p /tmp/bug4_start_$$ /tmp/bug4_dest_$$`; create `/tmp/bug4_dest_$$/canary.txt` with content `found_it`; seed DB in `implement` phase
    - EXERCISE: pipe two `--eval` calls in sequence within the same session using pipe mode:
      ```
      printf '__TOOL__:Bash:{"command":"cd /tmp/bug4_dest_$$"}\n__TOOL__:Read:{"file_path":"canary.txt"}\n/exit\n' \
        | LM_STUDIO_BASE_URL=... LM_STUDIO_MODEL=mock ona --cwd /tmp/bug4_start_$$
      ```
      Use the mock HTTP server (same pattern as `sdlc-acceptance.sh`) to drive the model to call Bash then Read in sequence
    - ASSERT: the `tool_result` for the Read call in `transcript_entries` has `is_error:false` and content contains `found_it`
    - ASSERT: `hook_invocations` contains a `CwdChanged` row with `input_json` containing `new_cwd` = `/tmp/bug4_dest_$$`
    - **Preservation**: a Bash command that does NOT cd leaves the next Read resolving against the original cwd
    - CLEANUP: `rm -rf /tmp/bug4_start_$$ /tmp/bug4_dest_$$`
    - **Expected on unfixed code**: Read returns `is_error:true` — `canary.txt` not found because cwd is still `/tmp/bug4_start_$$`
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 3.3_

- [x] 9. Fix Bug 4 — Bash CWD not persisted to `rt.cwd` (`lib/tools.mjs` + `lib/orchestrate.mjs`)
  - In `toolBash`, add `newCwd` to the return value: `resolve({ content, is_error: code !== 0, newCwd: newCwd || null })`
  - In `executeToolUses` in `orchestrate.mjs`, after `const out = await executeBuiltinTool(...)`, add: `if (toolName === 'Bash' && out.newCwd) rt.cwd = out.newCwd`
  - Run `bash tests/bugs/bug4_bash_cwd.sh` — must PASS
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3_

---

- [x] 10. Behavioral test — Bug 1: Streaming JSON truncation silently drops tool arguments
  - **Write test BEFORE fix. Must FAIL on unfixed code.**
  - Create `tests/bugs/bug1_streaming_truncation.sh`:
    - SETUP: create `/tmp/bug1_target_$$/realfile.txt` with content `real_content_here`
    - Start a mock HTTP server that streams a tool call for `Read` with a **truncated** `arguments` string — the JSON is cut off mid-value: `{"file_path":"/tmp/bug1_target_$$/real` (missing closing `file.txt"}`)
    - The mock server sends this as two SSE chunks: first chunk contains the truncated arguments, second chunk is `[DONE]`
    - EXERCISE: pipe a user message to `ona` pointed at the mock server
    - ASSERT: the `tool_result` in `transcript_entries` has `is_error:true` — the tool must NOT silently succeed with a truncated path
    - ASSERT: the `tool_result` content does NOT contain `real_content_here` — the file was not read with a garbage path
    - ASSERT: the `tool_result` content contains a parse error indicator (not a silent empty result)
    - **Preservation**: start a second mock server that streams a **complete** valid JSON arguments string for Read; assert `tool_result` has `is_error:false` and content contains `real_content_here`
    - CLEANUP: `rm -rf /tmp/bug1_target_$$`
    - **Expected on unfixed code**: `tool_result` has `is_error:true` with `Read: not found: /tmp/bug1_target_.../real` — truncated path passed silently to the tool
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 3.3_

- [x] 11. Fix Bug 1 — Streaming JSON truncation (`lib/openaiCompat.mjs`)
  - In `streamOpenAIChatCompletion`, replace `catch { input = { _raw: acc.arguments } }` with `catch { return { id: acc.id || \`call_\${idx}_\${Date.now()}\`, name: acc.name, input: { _parseError: true, _raw: acc.arguments.slice(0, 500) } } }`
  - This surfaces the parse failure as a structured error the tool dispatcher can reject with `is_error:true` and a message the model can see
  - Run `bash tests/bugs/bug1_streaming_truncation.sh` — must PASS
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3_

---

- [x] 12. Behavioral test — Bug 2: Model hallucinates after tool denial
  - **Write test BEFORE fix. Must FAIL on unfixed code.**
  - Create `tests/bugs/bug2_denial_hallucination.sh`:
    - SETUP: `fresh_db`; seed `settings_snapshot` with `{"permissions":{"defaultMode":"default","deny":["Write"]}}` so Write is always denied by policy
    - Start mock server that drives the model to call `Write` (sends a tool_calls response for Write)
    - EXERCISE: pipe a user message to `ona` pointed at the mock server
    - ASSERT: `tool_permission_log` has a row with `tool_name='Write'` and `decision='deny'`
    - ASSERT: the `tool_result` entry in `transcript_entries` for this Write call has content containing `Permission denied`
    - ASSERT: NO file was written at the path the model tried to write (file does not exist on disk)
    - ASSERT: the stdout of the `ona` process does NOT contain `[tool: Write]` — the label must not appear for a denied tool
    - **Preservation**: seed `settings_snapshot` with Write in `allow` list; drive model to call Write; assert `tool_result` has `is_error:false` and file IS created on disk
    - **Expected on unfixed code**: `[tool: Write]` appears in stdout before the deny decision; the model's subsequent response may hallucinate success
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

- [x] 13. Fix Bug 2 — Tool denial hallucination (`lib/orchestrate.mjs`)
  - In `executeToolUses`, move `io.onToolStart` / `io.write('[tool: ...]')` to after the permission check resolves to allow — denied tools never display the label
  - Track `deniedCount`; if all tools in the batch are denied, append a synthetic `user` transcript entry instructing the model to acknowledge the denial and stop
  - Run `bash tests/bugs/bug2_denial_hallucination.sh` — must PASS
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

---

- [x] 14. Behavioral test — Bug 5: Agent tool crashes with ReferenceError
  - **Write test BEFORE fix. Must FAIL on unfixed code.**
  - Create `tests/bugs/bug5_agent_crash.sh`:
    - SETUP: `fresh_db`; seed conversation in `implement` phase with approved plan
    - EXERCISE: `ona --eval '{"tool":"Agent","input":{"prompt":"echo hello"}}'`
    - ASSERT: `tool_result` in `transcript_entries` does NOT contain `ReferenceError`
    - ASSERT: `tool_result` `is_error` is `false` OR content is `(agent produced no output)` — either is acceptable; what is NOT acceptable is a ReferenceError
    - ASSERT: `sessions` table has at least 2 rows (original session + sub-session created by Agent)
    - ASSERT: `events` table has a row with `event_type='subagent_start'`
    - **Expected on unfixed code**: `tool_result` content is `[SDLC_INTERNAL] ReferenceError: output is not defined`; `is_error:true`
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 3.3_

- [x] 15. Fix Bug 5 — `toolAgent()` ReferenceError (`lib/tools.mjs`)
  - In `toolAgent`, move `const output = collected.join('')` to immediately after `await runUserTurn(...)` and before the `SubagentStop` hook call
  - Run `bash tests/bugs/bug5_agent_crash.sh` — must PASS
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3_

---

- [x] 16. Behavioral test — Bug 7: Second compaction corrupts summary with collapse_commit metadata
  - **Write test BEFORE fix. Must FAIL on unfixed code.**
  - Create `tests/bugs/bug7_compaction_corruption.sh`:
    - SETUP: `fresh_db`; seed 6 transcript entries (user/assistant alternating) directly via `sqlite3`
    - EXERCISE: `ona --compact` (or equivalent CLI flag that triggers `compactConversation`) — first compaction
    - ASSERT: `SELECT COUNT(*) FROM transcript_entries WHERE entry_type='collapse_commit'` equals 1
    - ASSERT: `SELECT content FROM summaries` does NOT contain `collapse_commit` or `compacted_count` (first compaction should be clean)
    - SETUP: insert 4 more transcript entries after the collapse_commit
    - EXERCISE: run compaction again — second compaction
    - ASSERT: `SELECT content FROM summaries ORDER BY rowid DESC LIMIT 1` does NOT contain `_t` or `collapse_commit` or `compacted_count` — the summary must not contain internal metadata from the previous collapse_commit entry
    - ASSERT: the summary DOES contain text from the user/assistant entries (not just metadata)
    - **Preservation**: first compaction (no prior collapse_commit) produces a clean summary — assert same conditions on first run
    - **Expected on unfixed code**: second compaction summary contains `"_t":"collapse_commit"` JSON blob from the previous collapse entry
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 3.3_

- [x] 17. Fix Bug 7 — Compaction includes collapse_commit in summary text (`lib/compact.mjs`)
  - In `compactConversation`, add `AND entry_type != 'collapse_commit'` to the entries SELECT query
  - Run `bash tests/bugs/bug7_compaction_corruption.sh` — must PASS
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3_

---

- [x] 18. Run full test suite — all bugs, no regressions
  - Run `bash tests/bugs/run-all.sh` — all 7 bug tests must PASS
  - Run `bash scripts/sdlc-acceptance.sh` — all existing acceptance rows must still PASS
  - If anything fails, fix before marking complete
  - _Requirements: all_
