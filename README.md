# ona-code

**ona** is a terminal-based SDLC REPL that gives you an agentic coding assistant backed by **any model** — local or cloud — with all session state persisted in a single SQLite database you own.

## Why we built it

Existing agentic coding tools lock you into one vendor's API and store session data in opaque formats you can't inspect or control. We wanted:

1. **Model freedom.** Run a local Qwen, Llama, or DeepSeek from [LM Studio](https://lmstudio.ai/) on your own hardware — or use Anthropic's Claude API, or any OpenAI-compatible endpoint. Switch providers mid-session with `/model`.

2. **Auditable local state.** Every conversation turn, tool call, hook invocation, and permission decision is a row in one SQLite file. No cloud sync, no opaque blobs. `sqlite3 ~/.ona/agent.db` and you see everything.

3. **Enforceable SDLC workflow.** A 6-phase state machine (`idle → planning → implement → test → verify → done`) with hard gates — mutating tools are blocked until a plan is approved, implementation can't skip testing, and the test phase generates behavioral tests from the plan rather than mocking the implementation.

4. **Credential safety.** API keys and tokens never touch the database. They live in OS secure storage, environment variables, or short-lived process memory.

Built from a [clean-room specification](https://github.com/AsobaCloud/ona-code/wiki/CLEAN_ROOM_SPEC) — not forked, not wrapped.

## Primary use cases

- **Local-first agentic coding** — Use a quantized model on your laptop with LM Studio for private, offline, zero-cost development assistance with tool use (file read/write, shell, search).
- **Auditable AI-assisted development** — Every model interaction and tool execution is persisted with full context in SQLite, suitable for compliance review or post-incident analysis.
- **Enforced development workflow** — The phase machine prevents "just ship it" by requiring plans before code, tests before verification, and operator sign-off before completion.
- **Multi-provider flexibility** — Start with a local model for exploration, switch to Claude for complex refactors, use an OpenAI-compatible proxy for team-managed endpoints — all in the same session.

## Requirements

- **Node.js 22+**
- For local models: [LM Studio](https://lmstudio.ai/) (or any OpenAI-compatible server)
- For Anthropic: an API key or OAuth credentials

## Install

```bash
git clone https://github.com/AsobaCloud/ona-code.git
cd ona-code
npm install
```

Optional — put `ona` on your PATH:

```bash
npm link
```

## Getting started

### Local model (LM Studio)

1. In LM Studio: download a model (e.g. Qwen 2.5 14B), **Load** it, then **Start Server**.
2. Note the model identifier shown in the Local Server panel.

```bash
export LM_STUDIO_MODEL="qwen2.5-coder-14b"

mkdir -p .ona && cat > .ona/settings.json << 'EOF'
{
  "model_config": {
    "provider": "lm_studio_local",
    "model_id": "lm_studio_server_routed"
  }
}
EOF

npm start
```

3. Type a message at the `ona>` prompt. The model streams its response, and may call tools (read files, run commands, search code) as part of answering.

### Anthropic Claude

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
npm start
```

Or use `/login` inside the REPL to store credentials securely (never in the database).

### OpenAI-compatible endpoint

```bash
export OPENAI_BASE_URL="https://your-endpoint/v1"
export OPENAI_API_KEY="your-key"

mkdir -p .ona && cat > .ona/settings.json << 'EOF'
{
  "model_config": {
    "provider": "openai_compatible",
    "model_id": "gpt_4o"
  }
}
EOF

npm start
```

## REPL commands

| Command | What it does |
|---------|-------------|
| `/help` | List all commands |
| `/model [id]` | Show or change the active model — takes effect immediately, no restart |
| `/login` | Store an API key, bearer token, or authenticate via browser OAuth |
| `/logout` | Clear stored credentials from secure storage |
| `/status` | Show which credential is active and its source (never prints secrets) |
| `/config` | Display current settings |
| `/clear` | Start a fresh conversation (aliases: `/reset`, `/new`) |
| `/exit` | Quit (alias: `/quit`) |

## Built-in tools (21)

The model can invoke these tools during a conversation:

| Category | Tools |
|----------|-------|
| **Filesystem** | `Read`, `Write`, `Edit`, `Glob`, `Grep` |
| **Shell** | `Bash` |
| **Notebook** | `NotebookEdit` |
| **Web** | `WebFetch`, `WebSearch` |
| **REPL** | `AskUserQuestion`, `Brief`, `TodoWrite`, `TaskOutput`, `TaskStop` |
| **Planning** | `EnterPlanMode`, `ExitPlanMode` |
| **Orchestration** | `Agent`, `Skill`, `ToolSearch` |
| **MCP** | `ListMcpResources`, `ReadMcpResource` |

## SDLC workflow

```
idle → planning → implement → test → verify → done
```

- **Planning gate**: mutating tools (Write, Edit, Bash, NotebookEdit) are blocked until a plan is approved.
- **Test phase**: behavioral tests are generated from the plan's success criteria — not from the implementation source. Tests assert against observable outcomes (DB state, file state, process output) and cannot mock implementation internals.
- **Verify phase**: displays a coverage report (plan requirement → test case → pass/fail) for operator sign-off.

## Environment variables

| Variable | Provider | Required | Default |
|----------|----------|----------|---------|
| `ANTHROPIC_API_KEY` | claude_code_subscription | yes* | — |
| `ANTHROPIC_AUTH_TOKEN` | claude_code_subscription | yes* | — |
| `ANTHROPIC_BASE_URL` | claude_code_subscription | no | `https://api.anthropic.com` |
| `OPENAI_API_KEY` | openai_compatible | yes | — |
| `OPENAI_BASE_URL` | openai_compatible | yes | — |
| `LM_STUDIO_BASE_URL` | lm_studio_local | no | `http://127.0.0.1:1234/v1` |
| `LM_STUDIO_API_KEY` | lm_studio_local | no | `lm-studio` |
| `LM_STUDIO_MODEL` | lm_studio_local | yes | — |
| `AGENT_SDLC_DB` | all | no | `~/.ona/agent.db` |
| `ONA_AUTH_PREFERENCE` | claude_code_subscription | no | `auto` |
| `SDLC_DISABLE_ALL_HOOKS` | all | no | — |

\*At least one of `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`.

## Verification

```bash
npm run verify       # hook event union order matches spec
npm run acceptance   # full acceptance test suite (11 automated checks)
```

## Project layout

```
ona-code/
├── bin/agent.mjs           # CLI entry point and REPL
├── lib/
│   ├── store.mjs           # SQLite connection, DDL, transactions
│   ├── transcript.mjs      # Conversation transcript persistence
│   ├── orchestrate.mjs     # Model turn loop (all providers)
│   ├── tools.mjs           # All 21 built-in tools
│   ├── hookplane.mjs       # Hook execution engine (27 events)
│   ├── auth.mjs            # Credential resolution + OAuth
│   ├── permissions.mjs     # Tool permission evaluation
│   ├── workflow.mjs        # 6-phase state machine
│   ├── settings.mjs        # Settings bootstrap + snapshot
│   ├── modelConfig.mjs     # Provider/model wire mapping
│   ├── openaiCompat.mjs    # OpenAI-compatible streaming client
│   ├── mcp.mjs             # MCP JSON-RPC client
│   └── ...
├── schema.sql              # SQLite DDL
├── scripts/                # Verification and acceptance tests
└── docs/                   # Acceptance matrix, cold start guide
```

## License

MIT
