/**
 * Model Discovery Service
 * Queries Ollama API to discover available models
 */

/**
 * Discover available models from an Ollama server
 * @param {string} baseUrl - Base URL of the Ollama server (e.g., "http://localhost:11434")
 * @param {Object} options - Discovery options
 * @param {number} options.timeout - Request timeout in milliseconds (default: 5000)
 * @returns {Promise<DiscoveryResult>} Discovery result with models or error
 */
export async function discoverOllamaModels(baseUrl, options = {}) {
  const timeout = options.timeout || 5000
  
  try {
    // Construct discovery URL - remove trailing slashes and append endpoint
    const cleanBaseUrl = baseUrl.replace(/\/+$/, '')
    const discoveryUrl = `${cleanBaseUrl}/api/tags`
    
    // Make HTTP GET request with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    
    let response
    try {
      response = await fetch(discoveryUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json'
        }
      })
    } finally {
      clearTimeout(timeoutId)
    }
    
    // Handle HTTP errors
    if (!response.ok) {
      const statusText = response.statusText || 'Unknown error'
      if (response.status === 404) {
        return {
          success: false,
          error: `Endpoint not found (404). The Ollama server at ${baseUrl} may not support model discovery.`
        }
      } else if (response.status >= 500) {
        return {
          success: false,
          error: `Server error (${response.status}): ${statusText}. The Ollama server encountered an internal error.`
        }
      } else {
        return {
          success: false,
          error: `HTTP error (${response.status}): ${statusText}`
        }
      }
    }
    
    // Parse JSON response
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      return {
        success: false,
        error: `Invalid JSON response from server: ${parseError.message}`
      }
    }
    
    // Validate response structure
    if (!data || typeof data !== 'object') {
      return {
        success: false,
        error: 'Invalid response format: expected JSON object'
      }
    }
    
    if (!Array.isArray(data.models)) {
      return {
        success: false,
        error: 'Invalid response format: missing or invalid "models" array'
      }
    }
    
    // Extract and validate model information
    const models = []
    for (const model of data.models) {
      // Skip invalid model entries
      if (!model || typeof model !== 'object') {
        continue
      }
      
      // Require non-empty name field
      if (!model.name || typeof model.name !== 'string' || !model.name.trim()) {
        continue
      }
      
      // Extract model information
      models.push({
        name: model.name,
        modified_at: model.modified_at || null,
        size: typeof model.size === 'number' ? model.size : 0,
        digest: model.digest || null,
        details: model.details || null
      })
    }
    
    return {
      success: true,
      models
    }
    
  } catch (error) {
    // Handle connection errors and timeouts
    if (error.name === 'AbortError') {
      return {
        success: false,
        error: `Request timed out after ${timeout}ms. The Ollama server may be slow or unreachable.`
      }
    }
    
    // Handle network/connection errors
    if (error.code === 'ECONNREFUSED' || error.message.includes('fetch failed')) {
      return {
        success: false,
        error: `Cannot connect to Ollama server at ${baseUrl}. Make sure Ollama is running and accessible.`
      }
    }
    
    // Generic error
    return {
      success: false,
      error: `Discovery failed: ${error.message}`
    }
  }
}

/**
 * Format a list of models for display
 * @param {Array} models - Array of model objects from discovery
 * @param {Object} options - Formatting options
 * @param {string} options.sortBy - Sort by 'date', 'name', or 'size' (default: 'date')
 * @param {boolean} options.verbose - Include detailed information (default: false)
 * @returns {string} Formatted model list
 */
export function formatModelList(models, options = {}) {
  const sortBy = options.sortBy || 'date'
  const verbose = options.verbose || false
  
  if (!models || models.length === 0) {
    return 'No models found on the server.\n\nTo pull a model, run: ollama pull <model-name>'
  }
  
  // Sort models
  const sorted = [...models]
  if (sortBy === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name))
  } else if (sortBy === 'size') {
    sorted.sort((a, b) => b.size - a.size)
  } else {
    // Sort by modification date (newest first)
    sorted.sort((a, b) => {
      if (!a.modified_at) return 1
      if (!b.modified_at) return -1
      return new Date(b.modified_at) - new Date(a.modified_at)
    })
  }
  
  // Format output
  const lines = []
  lines.push('Available models:\n')
  
  for (const model of sorted) {
    const size = formatBytes(model.size)
    
    if (verbose && model.details) {
      const paramSize = model.details.parameter_size || 'unknown'
      const quantization = model.details.quantization_level || 'unknown'
      lines.push(`  ${model.name}`)
      lines.push(`    Size: ${size}`)
      lines.push(`    Parameters: ${paramSize}`)
      lines.push(`    Quantization: ${quantization}`)
    } else {
      lines.push(`  ${model.name.padEnd(40)} ${size}`)
    }
  }
  
  lines.push('\nUsage: /model ollama/<model-name>')
  lines.push('Example: /model ollama/llama3')
  
  return lines.join('\n')
}

/**
 * Format bytes in human-readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
