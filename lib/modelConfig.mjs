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
  zhipu: {
    glm_4_7_flash: 'glm-4.7-flash',
  },
  ollama: {
    qwen2_5_14b: 'qwen2.5:14b',
    qwen2_5_7b: 'qwen2.5:7b',
    deepseek_coder_v2: 'deepseek-coder-v2',
    codegemma_7b: 'codegemma:7b',
  },
  lm_studio_local: {
    lm_studio_server_routed: 'lm_studio_server_routed',
  },
  // Nehanda vLLM gateway (nehanda-ml.asoba.co).
  // omitToolChoice: vLLM requires --enable-auto-tool-choice + --tool-call-parser
  // server-side flags to accept tool_choice:"auto". Without them the endpoint
  // returns HTTP 400. We omit tool_choice entirely; the gateway handles dispatch
  // through its own tool-call parser when those flags are enabled.
  nehanda: {
    nehanda_rag_synthesis_27b: 'nehanda-rag-synthesis-27b',
  },
}

/** Provider capabilities for custom model support and discovery */
const PROVIDER_CAPABILITIES = {
  claude_code_subscription: {
    supportsCustomModels: false,
    requiresHardcodedMap: true,
    supportsDiscovery: false,
  },
  openai_compatible: {
    supportsCustomModels: true,
    requiresHardcodedMap: false,
    supportsDiscovery: false,
  },
  zhipu: {
    supportsCustomModels: false,
    requiresHardcodedMap: true,
    supportsDiscovery: false,
  },
  ollama: {
    supportsCustomModels: true,
    requiresHardcodedMap: false,
    supportsDiscovery: true,
    discoveryEndpoint: '/api/tags',
  },
  lm_studio_local: {
    supportsCustomModels: true,
    requiresHardcodedMap: false,
    supportsDiscovery: false,
  },
  // Nehanda vLLM: omitToolChoice suppresses tool_choice:"auto" which causes
  // HTTP 400 on vLLM endpoints without --enable-auto-tool-choice.
  nehanda: {
    supportsCustomModels: false,
    requiresHardcodedMap: true,
    supportsDiscovery: false,
    omitToolChoice: true,
  },
}

/**
 * Check if a provider supports custom model names
 * @param {string} provider - Provider identifier
 * @returns {boolean} True if provider supports custom models
 */
export function supportsCustomModels(provider) {
  const capabilities = PROVIDER_CAPABILITIES[provider]
  return capabilities ? capabilities.supportsCustomModels : false
}

/**
 * Check if a provider supports model discovery
 * @param {string} provider - Provider identifier
 * @returns {boolean} True if provider supports discovery
 */
export function supportsDiscovery(provider) {
  const capabilities = PROVIDER_CAPABILITIES[provider]
  return capabilities ? capabilities.supportsDiscovery : false
}

/**
 * Get discovery endpoint for a provider
 * @param {string} provider - Provider identifier
 * @returns {string|null} Discovery endpoint or null
 */
export function getDiscoveryEndpoint(provider) {
  const capabilities = PROVIDER_CAPABILITIES[provider]
  return capabilities?.discoveryEndpoint || null
}



/**
 * Returns true if tool_choice:"auto" should be omitted for this provider.
 * vLLM without --enable-auto-tool-choice returns HTTP 400 otherwise.
 */
export function omitToolChoice(provider) {
  const capabilities = PROVIDER_CAPABILITIES[provider]
  return capabilities ? !!capabilities.omitToolChoice : false
}

export function resolveWireModel(modelConfig) {
  const { provider, model_id, custom_model_name } = modelConfig || {}
  
  // NEW: Check for custom model name first
  if (custom_model_name && custom_model_name.trim()) {
    return custom_model_name.trim()
  }
  
  // Fallback to WIRE map lookup
  const map = WIRE[provider]
  if (!map) throw new Error(`Unknown provider: ${provider}`)
  const w = map[model_id]
  if (w === undefined) throw new Error(`Invalid model_id ${model_id} for provider ${provider}`)

  if (provider === 'lm_studio_local') {
    const name = process.env.LM_STUDIO_MODEL
    if (!name || !name.trim()) throw new Error('LM_STUDIO_MODEL not set. Export it or use /model.')
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
