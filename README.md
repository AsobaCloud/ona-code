# ona-code

A terminal REPL that turns any LLM — local or cloud — into an agentic coding assistant. You talk to the model, it reads your files, runs commands, edits code, and searches the web. Every interaction is persisted in a single SQLite database you own. A built-in SDLC workflow enforces planning before implementation and behavioral testing before sign-off.

Supports three provider backends: [LM Studio](https://lmstudio.ai/) (run Qwen, Llama, DeepSeek, etc. on your own machine), Anthropic Claude, and any OpenAI-compatible API.

## Why we built it

We wanted an agentic coding tool that wasn't locked to one vendor and didn't hide state behind opaque cloud storage. Specifically:

- **Run local models with tool use.** LM Studio serves a model on localhost; ona gives it the ability to read files, run shell commands, write code, and search — the same tool surface a cloud model gets, but on your hardware, offline, for free.

- **Own your data.** Every conversation turn, tool call, hook invocation, and permission decision is a row in `~/.ona/agent.db`. No proprietary formats, no syncing, no vendor dashboard. `sqlite3` and you see everything.

- **Enforce development discipline.** Models are eager to write code and skip testing. ona has a 6-phase state machine (`idle → planning → implement → test → verify → done`) with hard gates — mutating tools are blocked until a plan is approved, the test phase generates behavioral tests from the plan (not from the implementation), and an operator must sign off on coverage before completion.

- **Keep secrets out of the database.** API keys and tokens live in OS secure storage or environment variables. They never touch SQLite.

## Primary use cases

- **Local-first agentic coding** — Load a quantized model in LM Studio, point ona at it, and get a private, offline coding assistant with full tool use. No API key, no internet, no cost per token.

- **Auditable AI-assisted development** — Need to show what the model did, what tools it called, and what permissions were granted? Every action is a queryable row in SQLite with timestamps and full payloads.

- **Enforced SDLC workflow** — The phase machine prevents shipping without planning and testing. Behavioral tests are generated from plan requirements, not by mocking the implementation — the test generator never sees implementation source code.

- **Multi-provider flexibility** — Start a session with a local model for exploration, switch to Claude for a complex refactor with `/model`, point at a team-managed OpenAI-compatible proxy — all without restarting.

## Install

Requires **Node.js 22+**.

```bash
git clone https://github.com/AsobaCloud/ona-code.git
cd ona-code
npm install
```

## Getting started

### With a local model (LM Studio + Qwen 2.5)

1. In LM Studio, download **Qwen 2.5 14B** (or any model), click **Load**, then **Start Server**.

2. Configure ona to use it:

```bash
export LM_STUDIO_MODEL="qwen2.5-coder-14b"
mkdir -p .ona && echo '{"model_config":{"provider":"lm_studio_local","model_id":"lm_studio_server_routed"}}' > .ona/settings.json
npm start
```

3. You'll see:

```
ona 0.2.0 — AGENT_SDLC_DB=/Users/you/.ona/agent.db
Provider: lm_studio_local  model: qwen2.5-coder-14b
Endpoint: http://127.0.0.1:1234/v1/chat/completions
LM Studio: load model, start server. No Anthropic credentials needed.
Commands: /help /model /login /logout /status /config /clear /exit

ona>
```

4. Ask it something:

```
ona> what files are in this directory?
```

The model streams its response. If it decides to call a tool (like `Glob` or `Bash`), you'll see:

```
I'll check what's in the current directory.

[tool: Glob]
Here are the files:
  bin/agent.mjs
  lib/store.mjs
  lib/tools.mjs
  ...
```

5. It can read, write, and edit files, run shell commands, search code, and fetch web pages — all while persisting the full conversation in SQLite. Type `/help` to see available commands, or just start working.

### With Anthropic Claude

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
npm start
```

### With any OpenAI-compatible endpoint

```bash
export OPENAI_BASE_URL="https://your-endpoint/v1"
export OPENAI_API_KEY="your-key"
mkdir -p .ona && echo '{"model_config":{"provider":"openai_compatible","model_id":"gpt_4o"}}' > .ona/settings.json
npm start
```
