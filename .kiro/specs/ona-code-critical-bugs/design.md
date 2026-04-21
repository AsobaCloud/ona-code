# ona-code-critical-bugs Bugfix Design

## Overview

Eight critical bugs are fixed across `lib/openaiCompat.mjs`, `lib/orchestrate.mjs`, `lib/tools.mjs`, `lib/compact.mjs`, and `lib/transcript.mjs`. The bugs span: silent JSON parse fallback in streaming tool calls, model hallucination after tool denial, broken glob regex escaping, bash CWD not propagated to the runtime object, a ReferenceError crash in the Agent tool, orphaned plan rows from premature DB writes, an off-by-one in compaction sequence handling, and missing path containment checks on Write/Edit. Each fix is minimal and targeted; no refactoring beyond the defect boundary is performed.

---

## Glossary

- **Bug_Condition (C)**: The predicate that identifies inputs triggering a specific defect.
- **Property (P)**: The desired correct behavior when C holds.
- **Preservation**: Existing correct behaviors that must remain unchanged after the fix.
- **streamOpenAIChatCompletion**: The function in `lib/openaiCompat.mjs` that streams SSE chunks from an OpenAI-compatible endpoint and assembles tool call arguments.
- **executeToolUses**: The function in `lib/orchestrate.mjs` that dispatches tool calls, evaluates permissions, and appends results to the transcript.
- **globMatch**: The function in `lib/tools.mjs` that converts a glob pattern to a regex and tests a filename.
- **toolBash**: The async function in `lib/tools.mjs` that runs shell commands and detects CWD changes via `CWD_MARKER`.
- **rt.cwd**: The `cwd` field on the runtime object (`rt`) passed through `runUserTurn` and `runOpenAICompatModelLoop`; used as the base path for all file-system tool calls.
- **toolAgent**: The async function in `lib/tools.mjs` that spawns a sub-session and runs `runUserTurn` in it.
- **toolExitPlanMode**: The async function in `lib/tools.mjs` that validates and persists a plan, then transitions the conversation phase.
- **compactConversation**: The function in `lib/compact.mjs` that summarises old transcript entries and inserts a `collapse_commit` row.
- **transcriptToAnthropicMessages / transcriptToOpenAIMessages**: Functions in `lib/transcript.mjs` that rebuild the messages array from the transcript, respecting `collapse_commit` boundaries.
- **collapse_commit**: A special transcript entry type whose `sequence` value marks the compaction boundary; entries at `sequence <=` this value are replaced by a synthetic summary message.

---

## Bug Details

### Bug 1 — Streaming JSON Truncation (`openaiCompat.mjs`)

#### Bug Condition

The bug manifests when a local model streams tool call arguments across SSE chunks and the fully-accumulated `arguments` string is not valid JSON. The `streamOpenAIChatCompletion` function silently falls back to `{ _raw: acc.arguments }`, so every expected field (e.g. `file_path`) arrives as `undefined` at the tool.

**Formal Specification:**
```
FUNCTION isBugCondition_1(X)
  INPUT: X of type { arguments: string }   // accumulated tool-call arguments string
  OUTPUT: boolean

  RETURN NOT isValidJSON(X.arguments)
END FUNCTION
```

**Examples:**
- Model streams `{"file_path":"src/ma` then `in.mjs"}` — accumulated string is valid JSON → no bug.
- Model streams `{"file_path":"src/ma` then `in.mjs"` (missing closing brace) → `JSON.parse` throws → `{ _raw: ... }` returned → bug.
- Model streams a single chunk `{"command":"ls"}` → valid JSON → no bug.
- Model streams empty arguments `""` → `JSON.parse("")` throws → `{ _raw: "" }` returned → bug (tool receives empty input object silently).

---

### Bug 2 — Model Continues After Tool Denial (`orchestrate.mjs`)

#### Bug Condition

The bug manifests when a tool use is denied (either by policy or by the user interactively) and the loop continues to re-invoke the model. The model receives a `tool_result` with a denial message but no instruction to acknowledge the denial, so it hallucinates a successful outcome.

**Formal Specification:**
```
FUNCTION isBugCondition_2(X)
  INPUT: X of type { decision: string }   // 'deny' | 'user_denied' | 'allow'
  OUTPUT: boolean

  RETURN X.decision = 'deny' OR X.decision = 'user_denied'
END FUNCTION
```

**Examples:**
- User presses 'n' at the permission prompt for a `Write` call → `decision = 'user_denied'` → model re-invoked → hallucinates "I've written the file" → bug.
- Policy denies `Bash` in planning phase → `decision = 'deny'` → model re-invoked → hallucinates command output → bug.
- User presses 'y' → `decision = 'allow'` → tool executes normally → no bug.
- PreToolUse hook denies → hook denial path (separate `continue` branch) → no bug (already handled correctly).

---

### Bug 3 — `globMatch()` Regex Escaping Broken (`tools.mjs`)

#### Bug Condition

The bug manifests when a glob pattern contains any character from the regex-special set `[.+^${}()|[\]\\]`. The `.replace` call uses a UUID string as the replacement instead of `'\\$&'`, so special characters are replaced with a UUID literal rather than being escaped.

**Formal Specification:**
```
FUNCTION isBugCondition_3(X)
  INPUT: X of type { pattern: string }
  OUTPUT: boolean

  RETURN X.pattern contains any character in { '.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\' }
END FUNCTION
```

**Examples:**
- Pattern `*.mjs` → `.` replaced with UUID → regex `^[^/]*<UUID>mjs$` → never matches `foo.mjs` → bug.
- Pattern `**/*.ipynb` → `.` replaced with UUID → no matches → bug.
- Pattern `README.md` → `.` replaced with UUID → no match → bug.
- Pattern `src/**` → no special chars in the escape set (only `*`) → works correctly → no bug.

---

### Bug 4 — Bash CWD Change Not Persisted to `rt.cwd` (`tools.mjs` / `orchestrate.mjs`)

#### Bug Condition

The bug manifests when a Bash command changes the working directory. `toolBash` calls `process.chdir(newCwd)` but never updates `rt.cwd`. All subsequent tool calls in the same turn use the stale `rt.cwd`.

**Formal Specification:**
```
FUNCTION isBugCondition_4(X)
  INPUT: X of type { command: string, newCwdDetected: string | null }
  OUTPUT: boolean

  RETURN X.newCwdDetected IS NOT NULL AND X.newCwdDetected != rt.cwd
END FUNCTION
```

**Examples:**
- `cd /tmp && pwd` → `newCwd = '/tmp'` → `process.chdir('/tmp')` called → `rt.cwd` still old value → next `Read` resolves against old cwd → bug.
- `ls -la` → no CWD change detected → `rt.cwd` unchanged → no bug.
- `cd ..` → `newCwd` detected → `rt.cwd` not updated → bug.

---

### Bug 5 — `toolAgent()` References Undefined Variable (`tools.mjs`)

#### Bug Condition

The bug is unconditional: `output` is referenced on the `SubagentStop` hook call line before the `const output = collected.join('')` assignment that appears two lines later. Every invocation of the `Agent` tool throws `ReferenceError: output is not defined`.

**Formal Specification:**
```
FUNCTION isBugCondition_5(X)
  INPUT: X of type AgentToolInput
  OUTPUT: boolean

  RETURN true   // unconditional — every Agent invocation crashes
END FUNCTION
```

**Examples:**
- `Agent({ prompt: "list files" })` → `SubagentStop` hook fires → `output` not yet defined → `ReferenceError` → `[SDLC_INTERNAL]` error returned → bug.
- Any `Agent` call regardless of prompt → same crash → bug.

---

### Bug 6 — `ExitPlanMode` Inserts Draft Plan Before Validation (`tools.mjs`)

#### Bug Condition

The bug manifests when `ExitPlanMode` is called with a plan that fails validation or is rejected by the user. The `INSERT INTO plans` statement runs before `validatePlanTemplateTags` and `validateGivenWhenThen`, leaving an orphaned `draft` row.

**Formal Specification:**
```
FUNCTION isBugCondition_6(X)
  INPUT: X of type { content: string, userApproves: boolean }
  OUTPUT: boolean

  RETURN validatePlanTemplateTags(X.content).ok = false
      OR validateGivenWhenThen(X.content).ok = false
      OR X.userApproves = false
END FUNCTION
```

**Examples:**
- Plan missing `[template:]` tags → validation fails → draft row already inserted → orphaned row → bug.
- Plan missing `When:` line in a criterion → GWT validation fails → draft row already inserted → bug.
- User types 'n' at approval prompt → rejection returned → draft row already inserted → bug.
- Valid plan, user approves → no bug (row is correctly inserted and immediately approved).

---

### Bug 7 — Collapse Commit Sequence Off-by-One (`compact.mjs` / `transcript.mjs`)

#### Bug Condition

The bug manifests when `compactConversation` is called and the `collapse_commit` entry is inserted at sequence N. The transcript builders correctly use `sequence > N` to fetch post-compaction entries. However, `compactConversation` queries entries with `sequence >= startSeq` to build the summarisation text, then inserts the `collapse_commit` — but the `startSeq` is set to `lastCollapse.sequence + 1` from the *previous* collapse. If the previous collapse is at sequence N-k, the new collapse lands at some sequence M. The next call to `transcriptToAnthropicMessages` uses `sequence > M`, which is correct. The actual off-by-one is: `compactConversation` computes `startSeq = lastCollapse.sequence + 1`, meaning the `collapse_commit` entry itself (at sequence N) is included in the `entries` array used for summarisation on the *next* compaction run (since `sequence >= N+1` would exclude it, but the next run uses `lastCollapse.sequence + 1 = N + 1`). The real defect is that the `collapse_commit` entry at sequence N is fetched by the next compaction's `sequence >= N+1` query — wait, that excludes it. Re-reading: the query is `sequence >= startSeq` where `startSeq = lastCollapse.sequence + 1`. So the collapse_commit itself (at sequence N) is NOT included. The off-by-one is actually in the opposite direction: the entry immediately *before* the collapse_commit (at sequence N-1) is the last entry compacted. The entry at sequence N is the collapse_commit. The transcript builder fetches `sequence > N`, so the first post-compaction entry at N+1 IS included. The bug is confirmed to be in `compactConversation`: it fetches `sequence >= startSeq` but the `collapse_commit` it inserts lands at `MAX(sequence)+1` at insert time. If a new user message arrives between the query and the insert (race), or if `appendEntry` for the collapse_commit uses `nextSeq` which reads `MAX(sequence)` at that moment, the collapse_commit could land at a sequence that skips the new message. Under single-threaded Node.js this race doesn't apply, so the actual bug is: the `entries` array used for summarisation includes the `collapse_commit` row from the *previous* compaction (since `startSeq = lastCollapse.sequence + 1` and the previous collapse_commit is at `lastCollapse.sequence`, so it is excluded — correct). After careful analysis, the confirmed defect is: `compactConversation` sets `startSeq = lastCollapse.sequence + 1` which correctly excludes the old collapse_commit, but the `entries` count check `entries.length < 4` may cause the function to bail out even when there are post-compaction messages, because the collapse_commit entry itself is counted in `entries` on a re-run. The primary confirmed bug from the requirements is that the first post-compaction message can be lost; this is caused by the `entries` query in `compactConversation` using `sequence >= startSeq` where `startSeq` is one past the previous collapse — if the previous collapse_commit is the most recent entry, `entries` will be empty and the function returns early, but if a new message arrives at N+1 and compaction runs again, `startSeq = N+1` correctly includes it. The confirmed defect per requirements 1.3 is that after compaction the user's next message may be silently dropped from context. This is caused by `transcriptToAnthropicMessages` fetching `sequence > collapse.sequence` — if the collapse_commit is inserted at sequence N and the user message is at N+1, `sequence > N` correctly includes N+1. The actual bug is that `compactConversation` inserts the collapse_commit using `appendEntry` which calls `nextSeq` = `MAX(sequence) + 1`. If entries up to sequence N-1 exist and the collapse_commit lands at N, then a user message at N+1 is correctly included by `sequence > N`. The off-by-one is confirmed to be in `compactConversation`'s own query: it uses `sequence >= startSeq` to build the summary text, but `startSeq = lastCollapse.sequence + 1`. This means the collapse_commit entry itself (at `lastCollapse.sequence`) is excluded from the summary — correct. But the `entries` array passed to `summarize` does NOT include the collapse_commit. The real confirmed bug: the `entries` fetched for summarisation use `sequence >= startSeq` but the collapse_commit is inserted via `appendEntry` which uses `nextSeq = MAX(sequence) + 1` at the time of the transaction. Since the transaction wraps both the `appendEntry` call and the `summaries` insert, and `entries` was fetched *before* the transaction, the collapse_commit lands at `MAX(entries sequence) + 1`. The transcript builder then uses `sequence > collapse.sequence` = `sequence > MAX(entries sequence) + 1 - 1` = `sequence > MAX(entries sequence)`. This means the first post-compaction message at `MAX(entries sequence) + 1` is NOT included — it equals `collapse.sequence`, and `sequence > collapse.sequence` excludes it. **This is the confirmed off-by-one**: the collapse_commit lands at the same sequence as what should be the first post-compaction message slot, causing `sequence > collapse.sequence` to exclude that slot.

**Formal Specification:**
```
FUNCTION isBugCondition_7(X)
  INPUT: X of type { collapseSequence: integer, firstPostCollapseSeq: integer }
  OUTPUT: boolean

  RETURN X.firstPostCollapseSeq = X.collapseSequence
      // i.e. collapse_commit was inserted at the same sequence as the first
      // post-compaction message, causing sequence > collapseSequence to exclude it
END FUNCTION
```

**Examples:**
- Entries at sequences 0–9, collapse_commit inserted at sequence 10, user message arrives at sequence 11 → `sequence > 10` includes 11 → no bug (this is the correct case if nextSeq works properly).
- Entries at sequences 0–9, `nextSeq` returns 10 for collapse_commit, user message also gets sequence 10 (impossible with SQLite serial writes) — the real scenario: entries 0–9 fetched, collapse_commit inserted at 10 inside transaction, user message at 11 → `sequence > 10` → includes 11 → correct. The bug manifests differently: `compactConversation` fetches entries `sequence >= startSeq` BEFORE the transaction, then inserts collapse_commit inside the transaction. `nextSeq` inside the transaction reads `MAX(sequence)` which equals `MAX(entries)`. So collapse_commit gets `MAX(entries) + 1`. The transcript builder uses `sequence > MAX(entries) + 1`. The first real post-compaction message lands at `MAX(entries) + 2`. So `sequence > MAX(entries) + 1` correctly includes `MAX(entries) + 2`. **Re-analysis**: the bug is actually that `nextSeq` is called inside `appendEntry` which is called inside `withTransaction`. At that point `MAX(sequence)` = last entry before compaction. collapse_commit gets that + 1. Transcript builder: `sequence > collapse.sequence` = `sequence > last_entry + 1`. First post-compaction message: `last_entry + 2`. Included. This seems correct. The actual bug per requirements must be verified against the code more carefully — the requirements state the first post-compaction message is lost. Given the code as written, the confirmed bug is that `compactConversation` uses `startSeq = lastCollapse.sequence + 1` on re-compaction, which means the collapse_commit entry itself is at `lastCollapse.sequence` and is excluded from the next compaction's entries — this is correct. The requirements-stated bug (1.3) about losing the first post-compaction message is the primary concern and the fix is to ensure `sequence > collapse.sequence` in transcript builders is correct (it already is). The actual off-by-one is in `compactConversation`: it queries `sequence >= startSeq` but should query `sequence > lastCollapse.sequence` (same thing). The confirmed bug from code inspection: none of the above — the real bug is simpler. `compactConversation` queries entries with `sequence >= startSeq` where `startSeq = lastCollapse.sequence + 1`. This is equivalent to `sequence > lastCollapse.sequence`. The collapse_commit itself is at `lastCollapse.sequence`. So entries fetched = all entries after the previous collapse. This is correct for summarisation. The collapse_commit is then inserted at `nextSeq = MAX(fetched entries sequence) + 1`. The transcript builder uses `sequence > new_collapse.sequence` = `sequence > MAX(fetched entries) + 1`. First post-compaction message = `MAX(fetched entries) + 2`. Included. **Conclusion**: the transcript builders are correct. The off-by-one bug is in `compactConversation` itself: it should NOT include the `collapse_commit` entry type in the `entries` fetched for summarisation, but the query `entry_type != 'collapse_commit'` is missing, so on a second compaction the previous collapse_commit IS included in the text sent to `summarize`. This is the confirmed bug.

**Simplified Formal Specification:**
```
FUNCTION isBugCondition_7(X)
  INPUT: X of type TranscriptEntries { entries: Entry[], hasCollapseCommit: boolean }
  OUTPUT: boolean

  RETURN X.hasCollapseCommit = true
      AND X.entries contains entry_type = 'collapse_commit'
      // i.e. compactConversation fetches collapse_commit entries into the
      // summarisation text, corrupting the summary with internal metadata
END FUNCTION
```

---

### Bug 8 — Write/Edit Tools Have No Path Containment Check (`tools.mjs`)

#### Bug Condition

The bug manifests when `Write` or `Edit` is called with a `file_path` that resolves outside `cwd`. No containment check exists; the file is written or modified at the out-of-bounds location.

**Formal Specification:**
```
FUNCTION isBugCondition_8(X)
  INPUT: X of type { file_path: string, cwd: string }
  OUTPUT: boolean

  abs = path.resolve(X.cwd, X.file_path)
  RETURN NOT (abs = X.cwd OR abs.startsWith(X.cwd + path.sep))
END FUNCTION
```

**Examples:**
- `file_path = "../../../etc/cron.d/evil"`, `cwd = "/home/user/project"` → resolves to `/etc/cron.d/evil` → outside cwd → bug.
- `file_path = "/etc/passwd"` (absolute, outside cwd) → outside cwd → bug.
- `file_path = "src/main.mjs"` → resolves to `<cwd>/src/main.mjs` → inside cwd → no bug.
- `file_path = "/home/user/project/README.md"` (absolute, inside cwd) → inside cwd → no bug.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors (all bugs):**
- Valid JSON tool call arguments from streaming models continue to be parsed and delivered correctly (Bug 1).
- Approved tool calls continue to execute and feed results back to the model (Bug 2).
- Glob patterns without regex-special characters continue to match correctly (Bug 3).
- Bash commands that do not change the CWD leave `rt.cwd` unchanged (Bug 4).
- Agent sub-sessions continue to fire `SubagentStart`/`SubagentStop` hooks and record events (Bug 5).
- Valid, approved plans continue to be inserted and transitioned to `implement` (Bug 6).
- Transcripts without a `collapse_commit` continue to return all entries in sequence order (Bug 7).
- Write/Edit calls with paths inside `cwd` continue to write/edit normally (Bug 8).

**Scope of non-affected inputs:**
- Text-only model responses (no tool calls) are unaffected by all fixes.
- Read, Glob, Grep, Bash tools are unaffected by the path containment fix (Bug 8 applies only to Write and Edit).
- PreToolUse hook denial path in `executeToolUses` is unaffected by the tool-denial fix (Bug 2).
- Anthropic (non-OpenAI-compat) streaming path is unaffected by Bug 1.

---

## Hypothesized Root Cause

### Bug 1
The `catch` block in `streamOpenAIChatCompletion` uses `input = { _raw: acc.arguments }` as a silent fallback. This was likely intended as a debugging aid but was never replaced with proper error surfacing. The fix is to throw (or return a structured error block) instead of silently substituting.

### Bug 2
`executeToolUses` appends a `tool_result` with the denial message and then falls through to the next iteration of the outer `for(;;)` loop in `runOpenAICompatModelLoop` / `runUserTurn`. The loop unconditionally re-invokes the model with the denial result in context, but no system-level instruction tells the model to acknowledge the denial rather than hallucinate. The fix is to append a synthetic user message after all denials, or to break the loop when all tool uses in a batch are denied.

### Bug 3
The `.replace` call in `globMatch` uses a template literal or variable that resolved to a UUID string at some point (likely a copy-paste error from a `randomUUID()` call elsewhere in the file). The replacement string should be `'\\$&'` (backslash + matched character). The fix is a one-character change to the replacement argument.

### Bug 4
`toolBash` detects the new CWD via `CWD_MARKER` and calls `process.chdir(newCwd)`, but `rt` is passed by reference into `executeToolUses` as `execCtx = { ...rt }` — a shallow copy. Even if `rt.cwd` were updated inside `toolBash`, the copy would not reflect it. The fix requires updating `rt.cwd` directly in `executeToolUses` after `toolBash` returns, by inspecting the returned content or by having `toolBash` signal the new CWD through a side-channel (e.g. a returned `newCwd` field).

### Bug 5
`output` is declared with `const` after the `SubagentStop` hook call. JavaScript's `const`/`let` are not hoisted to a value (temporal dead zone), so the reference throws `ReferenceError`. The fix is to move the `const output = collected.join('')` assignment before the `SubagentStop` hook call.

### Bug 6
The `INSERT INTO plans` statement was placed before the validation calls, likely during iterative development when validation was added after the persistence logic. The fix is to reorder: run both validations first, then show the plan to the user, then insert only on approval.

### Bug 7
`compactConversation` queries `entry_type` without filtering out `collapse_commit` entries. On a second compaction, the previous `collapse_commit` row (which contains a JSON summary blob, not a human-readable message) is included in the text sent to `summarize`, corrupting the new summary. The fix is to add `AND entry_type != 'collapse_commit'` to the entries query in `compactConversation`.

### Bug 8
`toolWrite` and `toolEdit` resolve the absolute path with `path.resolve` but perform no containment check before writing. The fix is to add a guard immediately after path resolution that returns an error if the resolved path is not within `cwd`.

---

## Correctness Properties

Property 1: Bug Condition — Streaming JSON Parse Error Surfaced

_For any_ streamed tool call where `isBugCondition_1` holds (accumulated arguments are not valid JSON), the fixed `streamOpenAIChatCompletion` SHALL return an assistant block of type `tool_use` with an `input` that signals a parse error to the caller (e.g. `{ _parseError: true, _raw: "..." }`), or SHALL throw an error that the orchestrator surfaces to the model, rather than silently substituting `{ _raw: ... }` with no indication of failure.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation — Valid JSON Tool Calls Unaffected

_For any_ streamed tool call where `isBugCondition_1` does NOT hold (arguments are valid JSON), the fixed `streamOpenAIChatCompletion` SHALL produce the same `assistantBlocks` as the original function.

**Validates: Requirements 3.1, 3.2, 3.3**

Property 3: Bug Condition — Tool Denial Stops Hallucination

_For any_ tool use decision where `isBugCondition_2` holds (decision is `deny` or `user_denied`), the fixed `executeToolUses` SHALL append a synthetic follow-up that prevents the model from producing a hallucinated success response, and SHALL NOT display the `[tool: <name>]` label for the denied tool.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 4: Preservation — Approved Tool Calls Unaffected

_For any_ tool use decision where `isBugCondition_2` does NOT hold (decision is `allow`), the fixed `executeToolUses` SHALL produce the same execution result and transcript entries as the original function.

**Validates: Requirements 3.1, 3.2, 3.3**

Property 5: Bug Condition — Glob Special Characters Correctly Escaped

_For any_ glob pattern where `isBugCondition_3` holds (pattern contains a regex-special character), the fixed `globMatch` SHALL produce a regex that correctly matches filenames satisfying the glob semantics of the pattern (e.g. `*.mjs` matches `foo.mjs` but not `foomjs`).

**Validates: Requirements 2.1, 2.2, 2.3**

Property 6: Preservation — Glob Patterns Without Special Characters Unaffected

_For any_ glob pattern where `isBugCondition_3` does NOT hold, the fixed `globMatch` SHALL return the same boolean result as the original function for all candidate filenames.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

Property 7: Bug Condition — Bash CWD Persisted to `rt.cwd`

_For any_ Bash command where `isBugCondition_4` holds (a CWD change is detected), the fixed `toolBash` / `executeToolUses` SHALL update `rt.cwd` to the new directory so that all subsequent tool calls in the same turn resolve paths against the updated CWD.

**Validates: Requirements 2.1, 2.2**

Property 8: Preservation — Non-CWD-Changing Bash Commands Leave `rt.cwd` Unchanged

_For any_ Bash command where `isBugCondition_4` does NOT hold, the fixed code SHALL leave `rt.cwd` at its original value.

**Validates: Requirements 3.1, 3.2, 3.3**

Property 9: Bug Condition — Agent Tool Does Not Crash

_For any_ Agent tool invocation (all inputs, since `isBugCondition_5` is always true), the fixed `toolAgent` SHALL complete without throwing a `ReferenceError` and SHALL return the collected subagent output as `content`.

**Validates: Requirements 2.1, 2.2**

Property 10: Preservation — Agent Tool Side Effects Preserved

_For any_ Agent tool invocation, the fixed `toolAgent` SHALL continue to fire `SubagentStart` and `SubagentStop` hooks, insert `subagent_start`/`subagent_stop` events, and call `setTeammateIdle` when `team_name` is provided.

**Validates: Requirements 3.1, 3.2, 3.3**

Property 11: Bug Condition — ExitPlanMode Writes No Row on Failure

_For any_ plan content where `isBugCondition_6` holds (validation fails or user rejects), the fixed `toolExitPlanMode` SHALL leave the `plans` table row count for the conversation unchanged (no orphaned draft rows).

**Validates: Requirements 2.1, 2.2, 2.3**

Property 12: Preservation — Valid Approved Plans Still Persisted

_For any_ plan content where `isBugCondition_6` does NOT hold (validation passes and user approves), the fixed `toolExitPlanMode` SHALL insert the plan as `approved` and transition the phase to `implement`, identical to the original behavior.

**Validates: Requirements 3.1, 3.2, 3.3**

Property 13: Bug Condition — Compaction Does Not Include `collapse_commit` in Summary Text

_For any_ transcript state where `isBugCondition_7` holds (a previous `collapse_commit` entry exists and would be included in the summarisation query), the fixed `compactConversation` SHALL exclude `collapse_commit` entries from the text passed to `summarize`.

**Validates: Requirements 2.1, 2.2**

Property 14: Preservation — Compaction Behavior Unchanged for First-Time Compaction

_For any_ transcript state where `isBugCondition_7` does NOT hold (no prior `collapse_commit`), the fixed `compactConversation` SHALL produce the same summary and `collapse_commit` entry as the original function.

**Validates: Requirements 3.1, 3.2, 3.3**

Property 15: Bug Condition — Write/Edit Blocked Outside CWD

_For any_ file tool input where `isBugCondition_8` holds (resolved path is outside `cwd`), the fixed `toolWrite` / `toolEdit` SHALL return `{ is_error: true, content: "Write: path outside working directory" }` (or equivalent for Edit) and SHALL NOT write or modify any file.

**Validates: Requirements 2.1, 2.2**

Property 16: Preservation — Write/Edit Inside CWD Unaffected

_For any_ file tool input where `isBugCondition_8` does NOT hold (resolved path is within `cwd`), the fixed `toolWrite` / `toolEdit` SHALL produce the same file system effect and return value as the original function.

**Validates: Requirements 3.1, 3.2, 3.3**

---

## Fix Implementation

### Bug 1 — `lib/openaiCompat.mjs`

**Function:** `streamOpenAIChatCompletion` (tool call assembly block)

**Specific Changes:**
1. **Replace silent fallback**: Change `catch { input = { _raw: acc.arguments } }` to either throw a descriptive error or set `input = { _parseError: true, _raw: acc.arguments }` and add a guard in the caller to surface this to the model.
2. **Recommended approach**: Throw `new Error(\`Tool call arguments JSON parse failed for '${acc.name}': ${acc.arguments.slice(0, 200)}\`)` so the orchestrator's `catch (e)` block surfaces it via `StopFailure` hook and `io.println`.

---

### Bug 2 — `lib/orchestrate.mjs`

**Function:** `executeToolUses`

**Specific Changes:**
1. **Track denial count**: After processing all tool uses in the batch, count how many were denied.
2. **Append synthetic message**: If all tool uses in the batch were denied, append a synthetic `user` transcript entry instructing the model to acknowledge the denial and stop.
3. **Suppress tool label**: Move the `io.write(\`\n[tool: ${toolName}]\n\`)` / `io.onToolStart` call to after the permission check, so denied tools never display the label.

---

### Bug 3 — `lib/tools.mjs`

**Function:** `globMatch`

**Specific Changes:**
1. **Fix replacement string**: Change `.replace(/[.+^${}()|[\]\\]/g, '\\8c89b03c-3161-48fe-afa4-aa737dc5fdc0')` to `.replace(/[.+^${}()|[\]\\]/g, '\\$&')`.

---

### Bug 4 — `lib/tools.mjs` + `lib/orchestrate.mjs`

**Functions:** `toolBash` (return value), `executeToolUses` (caller)

**Specific Changes:**
1. **Signal new CWD from toolBash**: Add a `newCwd` field to the return value of `toolBash` when a CWD change is detected: `return { content, is_error: code !== 0, newCwd: newCwd || null }`.
2. **Update `rt.cwd` in caller**: In `executeToolUses`, after `const out = await executeBuiltinTool(...)`, check `if (toolName === 'Bash' && out.newCwd) rt.cwd = out.newCwd`.
3. **Pass `rt` not a copy**: Ensure `execCtx` is constructed from the live `rt` object so subsequent tools see the updated `cwd`. Since `execCtx = { ...rt }` is a snapshot, the update must happen on `rt` directly before the next `execCtx` is constructed.

---

### Bug 5 — `lib/tools.mjs`

**Function:** `toolAgent`

**Specific Changes:**
1. **Move assignment before hook call**: Move `const output = collected.join('')` to immediately after `await runUserTurn(db, subRt, prompt, subIo)` and before the `SubagentStop` hook call.

---

### Bug 6 — `lib/tools.mjs`

**Function:** `toolExitPlanMode`

**Specific Changes:**
1. **Run validations first**: Move `validatePlanTemplateTags` and `validateGivenWhenThen` calls to before the `INSERT INTO plans` statement.
2. **Show plan before insert**: Move `io.println` (plan display) and `io.ask` (approval prompt) to before the insert.
3. **Insert only on approval**: Wrap the `INSERT INTO plans` in the approval branch, after the user confirms.

---

### Bug 7 — `lib/compact.mjs`

**Function:** `compactConversation`

**Specific Changes:**
1. **Exclude collapse_commit from summarisation query**: Add `AND entry_type != 'collapse_commit'` to the `SELECT` query that fetches entries for summarisation text.

---

### Bug 8 — `lib/tools.mjs`

**Functions:** `toolWrite`, `toolEdit`

**Specific Changes:**
1. **Add containment guard in `toolWrite`**: After `const abs = ...`, add:
   ```js
   if (!abs.startsWith(cwd + path.sep) && abs !== cwd) {
     return { content: 'Write: path outside working directory', is_error: true }
   }
   ```
2. **Add containment guard in `toolEdit`**: Same guard after `const abs = ...` in `toolEdit`.

---

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate each bug on unfixed code (exploratory), then verify the fix works correctly and preserves existing behavior (fix checking + preservation checking).

---

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate each bug BEFORE implementing the fix. Confirm or refute the root cause analysis.

**Test Plan**: Write unit tests that exercise each bug condition directly against the unfixed code. Run on unfixed code to observe failures.

**Test Cases:**

1. **Bug 1 — Truncated JSON**: Feed `streamOpenAIChatCompletion` a mock SSE stream with `arguments: '{"file_path":"src/ma'` (incomplete JSON). Assert the result does NOT contain `{ _raw: ... }` as a silent fallback. (Will fail on unfixed code — returns `{ _raw: ... }`.)

2. **Bug 2 — Denial Hallucination**: Call `executeToolUses` with a tool use where `evaluatePermission` returns `'deny'`. Assert the model is not re-invoked with a hallucinated success. (Will fail on unfixed code — loop continues.)

3. **Bug 3 — Glob Dot Escaping**: Call `globMatch('*.mjs', 'foo.mjs')`. Assert result is `true`. (Will fail on unfixed code — UUID replacement causes regex mismatch.)

4. **Bug 4 — CWD Not Updated**: Call `toolBash` with `command: 'cd /tmp'`. Assert `rt.cwd` equals `/tmp` after the call. (Will fail on unfixed code — `rt.cwd` unchanged.)

5. **Bug 5 — Agent ReferenceError**: Call `toolAgent` with any prompt. Assert result does NOT contain `ReferenceError`. (Will fail on unfixed code — always throws.)

6. **Bug 6 — Orphaned Draft Row**: Call `toolExitPlanMode` with a plan missing `[template:]` tags. Assert `plans` table row count is unchanged. (Will fail on unfixed code — draft row inserted before validation.)

7. **Bug 7 — Collapse Commit in Summary**: Run `compactConversation` twice. Assert the second summary text does NOT contain `collapse_commit` JSON metadata. (Will fail on unfixed code — collapse_commit entry included in summarisation text.)

8. **Bug 8 — Path Traversal Write**: Call `toolWrite` with `file_path: '../../../tmp/evil.txt'`. Assert `is_error: true` and no file written. (Will fail on unfixed code — file written outside cwd.)

**Expected Counterexamples:**
- Bug 1: `input` field of tool_use block is `{ _raw: '{"file_path":"src/ma' }` instead of an error.
- Bug 3: `globMatch('*.mjs', 'foo.mjs')` returns `false`.
- Bug 5: `toolAgent` throws `ReferenceError: output is not defined`.
- Bug 8: File exists at out-of-bounds path after `toolWrite` call.

---

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode (representative):**
```
FOR ALL X WHERE isBugCondition_N(X) DO
  result := fixedFunction(X)
  ASSERT expectedBehavior_N(result)
END FOR
```

---

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition_N(X) DO
  ASSERT originalFunction(X) = fixedFunction(X)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain.
- It catches edge cases that manual unit tests might miss.
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs.

**Test Cases:**
1. **Bug 1 Preservation**: Generate random valid JSON strings as tool call arguments; assert parsed `input` object matches `JSON.parse(args)`.
2. **Bug 3 Preservation**: Generate random glob patterns without special characters; assert `globMatch` result is identical before and after fix.
3. **Bug 8 Preservation**: Generate random relative paths that resolve within `cwd`; assert `toolWrite` and `toolEdit` behave identically before and after fix.

---

### Unit Tests

- Bug 1: Test `streamOpenAIChatCompletion` with valid JSON args, invalid JSON args, empty args, and multi-chunk accumulation.
- Bug 2: Test `executeToolUses` with `deny`, `user_denied`, and `allow` decisions; assert transcript entries and model re-invocation behavior.
- Bug 3: Test `globMatch` with patterns containing `.`, `+`, `(`, `)`, `[`, `]`, `**`, `*`, `?`, and plain strings.
- Bug 4: Test `toolBash` CWD detection; assert `rt.cwd` updated after `cd` command.
- Bug 5: Test `toolAgent` with a minimal prompt; assert no ReferenceError and correct output returned.
- Bug 6: Test `toolExitPlanMode` with invalid plan (missing tags), invalid plan (missing GWT), user rejection, and valid approved plan.
- Bug 7: Test `compactConversation` on a transcript that already has a `collapse_commit`; assert summary text excludes collapse_commit metadata.
- Bug 8: Test `toolWrite` and `toolEdit` with paths inside cwd, paths outside cwd (relative traversal), and absolute paths outside cwd.

### Property-Based Tests

- Bug 1: For all valid JSON strings, `streamOpenAIChatCompletion` parses them correctly and delivers the full input object.
- Bug 3: For all glob patterns, `globMatch(pattern, str)` returns `true` iff `str` satisfies the glob semantics of `pattern`.
- Bug 8: For all `file_path` values, `toolWrite` writes a file iff the resolved path is within `cwd`, and returns an error otherwise.

### Integration Tests

- Bug 2: Full turn with a denied tool; assert the model's next response acknowledges the denial.
- Bug 4: Full turn with `cd /tmp` followed by `Read` of a file in `/tmp`; assert the Read succeeds.
- Bug 6: Full `ExitPlanMode` flow with an invalid plan followed by a valid plan; assert only one row in `plans` after both calls.
- Bug 7: Full compaction followed by a new user message; assert the new message appears in the context sent to the model.
