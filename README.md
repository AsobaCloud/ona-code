# ona-code

A terminal REPL that turns any LLM into an agentic coding assistant. Point it at a local model running in LM Studio, or connect to Anthropic Claude or any OpenAI-compatible API. The model can read and write files, run shell commands, search code, and fetch web pages. Every interaction is stored in a single SQLite database you own — no cloud sync, no opaque state, no vendor lock-in.

## Why we built it

Agentic coding tools today require a specific vendor's API and store your session data somewhere you can't inspect. We wanted to run a local model on our own hardware with the same tool surface a cloud model gets — file editing, shell access, code search, web fetch — and have every turn persisted in a SQLite file we control. We also wanted an SDLC workflow that prevents shipping without planning and testing, with behavioral tests generated from the plan instead of mocking the implementation.

## Primary use cases

- **Local-first agentic coding** — Run a quantized model in LM Studio on your laptop. Private, offline, no API key, no cost per token, full tool use.
- **Auditable AI-assisted development** — Every conversation turn, tool call, and permission decision is a queryable row in SQLite with timestamps and full payloads.
- **Enforced SDLC workflow** — A 6-phase state machine requires a plan before code, behavioral tests before verification, and operator sign-off before completion.
- **Multi-provider flexibility** — Switch between a local model, Claude, or an OpenAI-compatible endpoint mid-session with `/model`.

## Getting started

**Requirements:** Node.js 22+

### 1. Clone and install

```bash
git clone https://github.com/AsobaCloud/ona-code.git
cd ona-code
npm install
```

### 2. Choose your provider

**Option A: Local model (LM Studio)**

Start LM Studio with a model loaded, then:

```bash
npm start
```

The REPL will auto-detect LM Studio on `http://localhost:8000`.

**Option B: Anthropic Claude**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

Then in the REPL:

```
ona> /model claude_sonnet_4
```

**Option C: OpenAI-compatible API**

```bash
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://api.openai.com/v1
npm start
```

Then in the REPL:

```
ona> /model gpt_4o
```

### 3. Start using it

```
ona 0.2.0 — AGENT_SDLC_DB=/Users/you/.ona/agent.db
Provider: lm_studio_local
Commands: /help /model /login /logout /status /config /clear /exit

ona> what files are in this project?

I'll take a look.

[tool: Glob]
Here are the files in the current directory:
  bin/agent.mjs
  lib/app.mjs
  lib/auth.mjs
  lib/tools.mjs
  lib/workflow.mjs
  package.json
  ...
```

### Available commands

- `/help` — List all commands
- `/model <name>` — Switch model mid-session
- `/login` — OAuth login for Anthropic
- `/logout` — Clear stored credentials
- `/status` — Show current auth status
- `/config` — View/edit session settings
- `/clear` — Clear conversation history
- `/exit` — Exit the REPL

### Database

All conversation turns, tool calls, and permissions are stored in SQLite at `$AGENT_SDLC_DB` (default: `~/.ona/agent.db`). You own the data — no cloud sync, no vendor lock-in.

### Testing

Run the behavioral test suite:

```bash
npm run acceptance
```

Run bug regression tests:

```bash
npm run test:bugs
```

Verify SDLC hook ordering:

```bash
npm run verify
```
## Architecture

The codebase is organized around the **CLEAN_ROOM_SPEC** — a formal specification that defines:

- **Providers** (§2): Anthropic, OpenAI-compatible, LM Studio local
- **Storage** (§4): SQLite schema with transcript, plans, hooks, permissions
- **Hook plane** (§5): Event-driven extensibility with permission gates
- **Tools** (§7): 21 built-in tools (file I/O, bash, web, search, etc.)
- **Workflow** (§8): 6-phase SDLC state machine (idle → planning → implement → test → verify → done)

### Key directories

- `bin/` — Entry point (`agent.mjs`)
- `lib/` — Core modules (app, auth, tools, workflow, permissions, orchestrate, etc.)
- `tests/` — Behavioral tests and bug regression tests
- `.kiro/specs/` — Spec documents and implementation plans
- `.claude-code/` — Reference implementation (for traceability only)

### Behavioral test coverage

The test suite validates **88% of normative requirements** from CLEAN_ROOM_SPEC:

- **42 passing tests** covering authentication, hooks, tools, workflow state
- **8 uncovered sections** identified for future implementation
- Coverage matrix: `tests/spec-behavioral/coverage/matrix.json`

See `.kiro/specs/missing-behavioral-test-coverage/` for the full spec and implementation plan.

## SDLC workflow

The tool enforces a structured development workflow:

1. **Planning** — Write a plan with success criteria (tagged with test templates)
2. **Implementation** — Code the solution
3. **Testing** — Generate behavioral tests from the plan (epistemic isolation enforced)
4. **Verification** — Operator reviews test results and coverage
5. **Completion** — Mark as done

This prevents shipping without planning and ensures tests validate the plan, not the implementation.

## Development

### Run tests

```bash
# Full acceptance test suite
npm run acceptance

# Bug regression tests
npm run test:bugs

# Verify SDLC hook ordering
npm run verify
```

### Project structure

```
ona-code/
├── bin/
│   └── agent.mjs              # Entry point
├── lib/
│   ├── app.mjs                # Main REPL app
│   ├── auth.mjs               # Authentication (OAuth, API keys, keychain)
│   ├── tools.mjs              # Tool implementations
│   ├── workflow.mjs           # SDLC phase transitions
│   ├── permissions.mjs        # Permission evaluation
│   ├── orchestrate.mjs        # Turn loop orchestration
│   ├── compact.mjs            # Session compaction
│   ├── openaiCompat.mjs       # OpenAI-compatible provider
│   └── ...
├── tests/
│   ├── spec-behavioral/       # Behavioral tests (42 tests, 88% coverage)
│   ├── bugs/                  # Bug regression tests
│   └── test.db                # Test database
├── scripts/
│   ├── sdlc-acceptance.sh     # Acceptance test runner
│   └── verify-sdlc-hook-order.mjs
├── .kiro/specs/               # Spec documents
│   ├── missing-behavioral-test-coverage/
│   ├── ona-code-critical-bugs/
│   └── zai-api-key-not-found/
└── .claude-code/              # Reference implementation (read-only)
```

## Contributing

This project uses spec-driven development. Before implementing:

1. Check `.kiro/specs/` for existing specs
2. Review `CLEAN_ROOM_SPEC.md` (in `.claude-code/`) for normative requirements
3. Run behavioral tests to identify coverage gaps
4. Create a spec document for your feature or bugfix
5. Implement with tests

## License

See LICENSE file.
