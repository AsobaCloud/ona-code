# Testing ona-code

## Philosophy

ona-code tests itself the way a user would use it: from the outside. No test frameworks. No module imports. No mocking internal functions. Every test invokes the `ona` binary or `sqlite3` as an external process and checks observable outcomes.

This exists because LLM-generated tests that import internal modules produce false confidence. Our previous acceptance tests all passed while the product couldn't respond to user input. The current approach makes that impossible.

## Two testing systems

ona-code has two completely separate testing concepts:

| System | Purpose | What it tests | How |
|--------|---------|--------------|-----|
| **Acceptance tests** (`npm run acceptance`) | Tests ona-code itself | The product's tools, workflow, hooks, permissions, UI | Black-box bash script with mock LLM server |
| **`/test` phase** (SDLC workflow) | Tests the user's implementation | Whatever the user built during the `implement` phase | Given/When/Then from the approved plan, translated to bash |

This document covers the **acceptance tests**. The `/test` phase is part of the SDLC workflow and is documented in the clean room spec (section 8).

## Running

```bash
npm run acceptance
```

Requires: `node` (22+), `sqlite3`, `python3`. No LM Studio or API keys needed. The test suite runs a mock LLM server internally.

Exit code 0 = all pass. Non-zero = first failing row printed to stderr.

## Architecture

```
                    ┌─────────────┐
                    │  Mock LLM   │
                    │  (Python)   │
                    │  port 187xx │
                    └──────┬──────┘
                           │ HTTP (SSE streaming)
                           │
┌──────────────┐    ┌──────▼──────┐    ┌──────────────┐
│ Test script  │───>│    ona      │───>│  SQLite DB   │
│ (bash)       │    │  (node)     │    │  (temp file) │
│              │<───│             │<───│              │
└──────────────┘    └─────────────┘    └──────────────┘
      │                                       │
      │              sqlite3                  │
      └───────────────────────────────────────┘
            Direct DB assertions
```

1. **Mock LLM server** — Python HTTP server that mimics OpenAI's `/v1/chat/completions` endpoint with SSE streaming. Responds to special directives in messages.
2. **ona CLI** — The product under test. Receives piped input, connects to mock server, executes tools, persists to SQLite.
3. **SQLite assertions** — Tests query the database directly to verify tool results, hook invocations, phase transitions, and transcript entries.

## Mock server protocol

The mock server parses the last user message for directives:

| Directive | Mock response | Use case |
|-----------|--------------|----------|
| `__TOOL__:Read:{"file_path":"/tmp/x"}` | Returns an SSE tool_call for `Read` with those args | Test tool execution |
| `__ASSIST_TEXT__:hello world` | Returns SSE text content `hello world` | Test transcript persistence |
| *(no directive)* | Returns `(mock) no directive` | Default behavior |

The mock returns proper SSE streaming chunks (not plain JSON), matching what LM Studio and OpenAI return. This tests the full streaming parser path.

## Helper functions

### `fresh_db <name>`

Creates a fresh temporary SQLite database via `ona --init-db`. Sets `AGENT_SDLC_DB` to the new path. Each test gets its own DB for isolation.

### `db <sql>`

Runs a SQLite query against `$AGENT_SDLC_DB` with the required pragmas (foreign_keys, busy_timeout). Use for all DB assertions.

### `tool_one <row> <tool_name> <args_json>`

The key helper for tool tests. Creates a fresh DB seeded in `implement` phase with an approved plan (so the planning gate allows mutating tools), then runs `ona --eval` with the specified tool. Returns the JSON result directly.

```bash
pj=$(tool_one 60 Read '{"file_path":"/tmp/test.txt"}')
echo "$pj" | grep -q '"is_error":false'
```

### `write_mock_server <port>`

Starts the Python mock LLM server on the specified port. Sets `MOCK_PID` for cleanup.

### `put_effective_json <json>`

Seeds the `settings_snapshot` table with the given JSON as the `effective` scope. Used to configure hooks, permissions, and model settings for specific tests.

## Adding a test row

1. Choose a row ID following the convention: `ROW-XX` where XX groups by spec section (01-08: storage, 10-14: providers, 20-25: auth, 30-38: REPL, 40-49: hooks, 50-53: permissions, 60-86: tools, 90-96: workflow, 100-102: forbidden, 110-112: payloads).

2. Write a function:

```bash
row_XX() {
  fresh_db rowXX
  # Setup: create fixtures, seed DB
  # Exercise: pipe input to ona or use tool_one
  # Assert: query DB with db(), grep output, check files
}
run_check ROW-XX row_XX
```

3. The function must return 0 on pass, non-zero on fail. Use `grep -q` for assertions, `test` for comparisons.

4. Do NOT import Node modules. Do NOT call internal functions directly. If you can't test it from the outside, flag it — don't fake it.

## Row inventory (34 rows)

| Group | Rows | Count |
|-------|------|-------|
| DDL/Schema | ROW-01 to ROW-05 | 5 |
| REPL commands | ROW-30 to ROW-38 | 6 |
| Hooks | ROW-40, ROW-49 | 2 |
| Permissions | ROW-50 to ROW-52 | 3 |
| Tools | ROW-60 to ROW-85 | 10 |
| Workflow | ROW-91, ROW-92, ROW-95 | 3 |
| Forbidden patterns | ROW-100 | 1 |
| Payloads | ROW-110, ROW-111 | 2 |
| **Total** | | **34** |

## What's NOT tested yet

The following spec sections have coverage gaps:

- Providers (ROW-10 to ROW-14): live provider tests with mock server
- Auth capabilities (ROW-20 to ROW-25): env var auth, logout, secret hiding, bare mode
- Hook stdin fields (ROW-46 to ROW-48): stdin JSON shape, newline, env vars
- Hook behavior (ROW-41 to ROW-45): sequential ordinals, exit 2 blocking, timeout, permission merge
- More tools (ROW-69 to ROW-82): Bash stderr/truncation, NotebookEdit, WebFetch, WebSearch, ExitPlanMode, AskUserQuestion, Brief, TodoWrite, TaskOutput, TaskStop, Agent
- Workflow gates (ROW-93, ROW-94, ROW-96): test->verify, planning requires plan, non-mutating allowed

These should be added incrementally. Each is straightforward using the existing helpers.
