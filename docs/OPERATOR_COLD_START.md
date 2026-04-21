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

## Verify

```bash
npm run verify        # hook order check
npm run acceptance    # full acceptance suite
```
