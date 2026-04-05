/** §2.2 — wire model strings */
const WIRE = {
  claude_code_subscription: {
    claude_opus_4: 'claude-opus-4-20250514',
    claude_sonnet_4: 'claude-sonnet-4-20250514',
    claude_3_5_haiku: 'claude-3-5-haiku-20241022',
  },
  openai_compatible: {
    gpt_4o: 'gpt-4o',
    gpt_4o_mini: 'gpt-4o-mini',
    o3: 'o3',
    o3_mini: 'o3-mini',
  },
  lm_studio_local: {
    lm_studio_server_routed: 'lm_studio_server_routed',
  },
}

export function resolveWireModel(modelConfig) {
  const { provider, model_id } = modelConfig || {}
  const map = WIRE[provider]
  if (!map) throw new Error(`Unknown provider: ${provider}`)
  const w = map[model_id]
  if (w === undefined) throw new Error(`Invalid model_id ${model_id} for provider ${provider}`)

  if (provider === 'lm_studio_local') {
    const name = modelConfig.lm_studio_model || process.env.LM_STUDIO_MODEL
    if (!name || !name.trim()) throw new Error('No LM Studio model configured. Use /model to set one.')
    return name.trim()
  }

  return w
}

export function anthropicBaseUrl() {
  return (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '')
}

/** All valid provider → model_id mappings for /model command. */
export function allModelIds() {
  const out = []
  for (const [prov, map] of Object.entries(WIRE)) {
    for (const mid of Object.keys(map)) {
      out.push({ provider: prov, model_id: mid })
    }
  }
  return out
}
