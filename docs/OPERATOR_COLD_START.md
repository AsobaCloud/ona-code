# Operator Cold Start — ona-code

From clean clone to first successful model turn in ≤12 steps.

## LM Studio (local model, no API key required)

1. `git clone <repo-url> ona-code && cd ona-code`
2. `npm install`
3. Open LM Studio, download a model (e.g. Qwen2.5 14B), click **Load**, then **Start Server**
4. Note the model identifier shown in the Local Server panel (e.g. `qwen2.5-coder-14b`)
5. `export LM_STUDIO_MODEL="qwen2.5-coder-14b"` (use your actual model id from step 4)
6. Create `.ona/settings.json`:
   ```bash
   mkdir -p .ona && echo '{"model_config":{"provider":"lm_studio_local","model_id":"lm_studio_server_routed"}}' > .ona/settings.json
   ```
7. `npm start`
8. Type a message at the `ona>` prompt — model response streams back

## Anthropic API (cloud)

1. `git clone <repo-url> ona-code && cd ona-code`
2. `npm install`
3. `export ANTHROPIC_API_KEY="sk-ant-..."`
4. `npm start`
5. Type a message at the `ona>` prompt

## OpenAI-compatible (remote)

1. `git clone <repo-url> ona-code && cd ona-code`
2. `npm install`
3. `export OPENAI_BASE_URL="https://your-endpoint/v1"`
4. `export OPENAI_API_KEY="your-key"`
5. Create `.ona/settings.json`:
   ```bash
   mkdir -p .ona && echo '{"model_config":{"provider":"openai_compatible","model_id":"gpt_4o"}}' > .ona/settings.json
   ```
6. `npm start`
7. Type a message at the `ona>` prompt

## Zhipu AI (cloud)

1. `git clone <repo-url> ona-code && cd ona-code`
2. `npm install`
3. Create `.ona/settings.json`:
   ```bash
   mkdir -p .ona && echo '{"model_config":{"provider":"zhipu","model_id":"glm_4_7_flash"}}' > .ona/settings.json
   ```
4. `npm start`
5. Run `/login` and choose option 4 to save your ZAI API key

## Remote Ollama (another machine on the LAN)

Use this when Ollama is running on a different machine (e.g. a Windows PC on the same network).
See [OLLAMA_WINDOWS_SERVER_SETUP.md](./OLLAMA_WINDOWS_SERVER_SETUP.md) for how to configure the server side.

**Prerequisites:** Ollama must be running on the remote machine with `OLLAMA_HOST=0.0.0.0` and port 11434 open in the firewall.

1. `git clone <repo-url> ona-code && cd ona-code`
2. `npm install`
3. Create `.ona/settings.json` pointing at the remote host:
   ```bash
   mkdir -p .ona && cat > .ona/settings.json << 'EOF'
   {
     "model_config": {
       "provider": "openai_compatible",
       "model_id": "gpt_4o",
       "base_url": "http://AsobaCorp-1.local:11434/v1"
     }
   }
   EOF
   ```
   Replace `AsobaCorp-1.local` with your machine's hostname or IP address.
4. `npm start`
5. Switch to the model you want to use:
   ```
   ona> /model openai_compatible/deepseek-coder-v2:latest
   ```
   Any model name from `ollama list` on the remote machine works here.
6. Type a message at the `ona>` prompt — the request is forwarded to the remote Ollama server

**Notes:**
- The `openai_compatible` provider is used because Ollama's `/v1/chat/completions` endpoint is OpenAI-compatible. This is the recommended approach for remote Ollama.
- Alternatively, use `provider: ollama` — this also enables the `/models` command for live model discovery from the REPL:
  ```bash
  {"model_config":{"provider":"ollama","model_id":"qwen2_5_14b","base_url":"http://AsobaCorp-1.local:11434/v1"}}
  ```
  Then run `/models` in the REPL to list all models installed on the remote server.
- The `base_url` is persisted in SQLite after first use — you can also change it at runtime with `/config` or by editing `.ona/settings.json` and restarting.

## Verify

```bash
npm run verify        # hook order check
npm run acceptance    # full acceptance suite
```
