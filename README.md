# ona-code

A terminal REPL that turns any LLM into an agentic coding assistant. Point it at a local model running in LM Studio, or connect to Anthropic Claude or any OpenAI-compatible API. The model can read and write files, run shell commands, search code, and fetch web pages. Every interaction is stored in a single SQLite database you own — no cloud sync, no opaque state, no vendor lock-in.

## Why we built it

Agentic coding tools today require a specific vendor's API and store your session data somewhere you can't inspect. We wanted to run a local model on our own hardware with the same tool surface a cloud model gets — file editing, shell access, code search, web fetch — and have every turn persisted in a SQLite file we control. We also wanted an SDLC workflow that prevents shipping without planning and testing, with behavioral tests generated from the plan instead of mocking the implementation.

## Primary use cases

- **Local-first agentic coding** — Run a quantized model in LM Studio on your laptop. Private, offline, no API key, no cost per token, full tool use.
- **Auditable AI-assisted development** — Every conversation turn, tool call, and permission decision is a queryable row in SQLite with timestamps and full payloads.
- **Enforced SDLC workflow** — A 6-phase state machine requires a plan before code, behavioral tests before verification, and operator sign-off before completion.
- **Multi-provider flexibility** — Switch between a local model, Claude, or an OpenAI-compatible endpoint mid-session with `/model`.

## Install and getting started

Requires Node.js 22+.

```
git clone https://github.com/AsobaCloud/ona-code.git
cd ona-code
npm install
npm link
```

Start it:

```
ona
```

```
ona 0.2.0 — AGENT_SDLC_DB=/Users/you/.ona/agent.db
Provider: lm_studio_local
Commands: /help /model /login /logout /status /config /clear /exit

ona>
```

Set your model (with LM Studio running and a model loaded):

```
ona> /model qwen2.5-coder-14b
Model changed: lm_studio_local/lm_studio_server_routed (wire: qwen2.5-coder-14b)
```

Start working:

```
ona> what files are in this project?

I'll take a look.

[tool: Glob]
Here are the files in the current directory:
  bin/agent.mjs
  lib/store.mjs
  lib/tools.mjs
  schema.sql
  ...
```

For Anthropic Claude: `/model claude_sonnet_4` and set `ANTHROPIC_API_KEY`. For OpenAI-compatible endpoints: `/model gpt_4o` and set `OPENAI_BASE_URL` + `OPENAI_API_KEY`.
