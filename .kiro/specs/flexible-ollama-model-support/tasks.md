# Implementation Plan: Flexible Ollama Model Support

## Overview

This implementation plan addresses three critical needs for the ona CLI tool:

1. **Phase 1: Fix Persistence Bug (CRITICAL)** - Settings are currently lost on restart due to `bootstrapSettings()` unconditionally overwriting the database. This must be fixed first as it affects all users.

2. **Phase 2: Custom Model Support** - Enable arbitrary model names for flexible providers (ollama, openai_compatible, lm_studio_local) without requiring hardcoded entries in the WIRE map.

3. **Phase 3: Model Discovery** - Add a `/models` command that queries the Ollama API to discover available models, improving user experience.

The implementation follows the phased approach specified in the design document, with Phase 1 being critical and blocking for the other phases.

## Tasks

### Phase 1: Fix Persistence Bug (CRITICAL - MUST BE DONE FIRST)

- [x] 1. Fix settings persistence in lib/settings.mjs
  - [x] 1.1 Add getFileModificationTime() helper function
    - Create helper function that returns file mtime or null if file doesn't exist
    - Use fs.statSync() to get file modification time
    - Handle errors gracefully (return null for non-existent files)
    - _Requirements: 14.1, 14.4_
  
  - [x] 1.2 Update bootstrapSettings() with merge-based persistence strategy
    - Read existing database settings BEFORE deciding to overwrite
    - Add timestamp comparison logic (file mtime vs database updated_at)
    - Implement three-way merge strategy: Database > File > Defaults
    - Only update database when necessary (first run or file is newer)
    - Track newest file modification time across all settings files
    - Add source field to track merge reason (bootstrap-first-run, bootstrap-file-newer, bootstrap-db-preserved)
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 19.1, 19.2, 19.3_
  
  - [x] 1.3 Write property test for settings persistence idempotence
    - **Property 1: Settings Persistence Across Sessions**
    - **Validates: Requirements 4.1, 4.2, 4.4**
    - Test that multiple startups without changes return identical settings
    - Test that runtime changes (via /model) are preserved across restarts
    - Use fast-check to generate arbitrary settings objects
  
  - [x] 1.4 Write property test for file vs database precedence
    - **Property 2: File Edits Respected**
    - **Property 3: Database Precedence for Runtime Changes**
    - **Validates: Requirements 5.1, 5.2, 6.3**
    - Test that newer files take precedence over older database
    - Test that newer database preserves runtime changes over older files
    - Use fast-check to generate settings with different timestamps
  
  - [x] 1.5 Write unit tests for bootstrapSettings() edge cases
    - Test first run with no database, no files (uses defaults)
    - Test first run with settings file present (merges file > defaults)
    - Test startup with existing database, no files (preserves database)
    - Test startup with database older than file (merges file > database > defaults)
    - Test startup with database newer than file (preserves database, ignores file)
    - Test startup with multiple settings files (merges all files)
    - Test startup with corrupted settings file (skips file, uses database/defaults)
    - Test startup with corrupted database JSON (reinitializes from file/defaults)
    - Test source tracking (bootstrap-first-run, bootstrap-file-newer, bootstrap-db-preserved)
    - _Requirements: 4.3, 5.4, 5.5, 6.1, 6.2, 6.3, 19.1, 19.2, 19.3_

- [x] 2. Checkpoint - Verify persistence fix works correctly
  - Ensure all tests pass
  - Manually test: set model via /model, restart ona, verify model is preserved
  - Manually test: edit settings file, restart ona, verify file changes are respected
  - Ask the user if questions arise

### Phase 2: Custom Model Support

- [x] 3. Add custom_model_name support to model resolution
  - [x] 3.1 Update resolveWireModel() in lib/modelConfig.mjs
    - Add check for custom_model_name field at the beginning of function
    - If custom_model_name is present and non-empty, return it directly
    - Preserve existing WIRE map lookup logic as fallback
    - Maintain backward compatibility with existing configurations
    - _Requirements: 1.1, 1.3, 3.1, 3.2, 10.3, 10.4_
  
  - [ ]* 3.2 Write property test for custom model name precedence
    - **Property 5: Custom Model Name Takes Precedence**
    - **Validates: Requirements 1.1, 1.3, 10.3**
    - Test that any non-empty custom_model_name is returned unchanged
    - Use fast-check to generate arbitrary custom model names
  
  - [ ]* 3.3 Write property test for backward compatibility
    - **Property 6: Backward Compatibility Preserved**
    - **Validates: Requirements 3.1, 3.2, 10.4**
    - Test that configurations without custom_model_name produce same output as before
    - Compare new implementation against expected WIRE map results
  
  - [ ]* 3.4 Write unit tests for resolveWireModel()
    - Test custom_model_name takes precedence over WIRE map
    - Test fallback to WIRE map when custom_model_name absent
    - Test error thrown for unknown provider
    - Test error thrown for invalid model_id (no custom_model_name)
    - Test lm_studio_local env var logic still works
    - Test empty custom_model_name falls back to WIRE map
    - _Requirements: 1.1, 1.2, 3.1, 3.2, 3.3, 12.3, 12.4, 12.5_

- [x] 4. Add provider capability system
  - [x] 4.1 Create PROVIDER_CAPABILITIES map in lib/modelConfig.mjs
    - Define capabilities for each provider (supportsCustomModels, requiresHardcodedMap)
    - Set supportsCustomModels: true for openai_compatible, ollama, lm_studio_local
    - Set supportsCustomModels: false for claude_code_subscription, zhipu
    - Export supportsCustomModels() helper function
    - _Requirements: 2.1, 2.2, 2.5_
  
  - [ ]* 4.2 Write unit tests for provider capabilities
    - Test supportsCustomModels returns true for flexible providers
    - Test supportsCustomModels returns false for restricted providers
    - Test all providers have capability definitions
    - _Requirements: 2.1, 2.2, 2.5_

- [x] 5. Update model selection logic in bin/agent.mjs
  - [x] 5.1 Update resolveModelArg() function
    - First, try exact match in hardcoded WIRE map (backward compatibility)
    - For provider/model format: parse and check provider capabilities
    - If provider supports custom models and no WIRE match: create config with custom_model_name
    - If provider doesn't support custom models and no WIRE match: return null (error)
    - For freeform names (no provider): search WIRE map first, then default to openai_compatible with custom_model_name
    - _Requirements: 1.4, 2.3, 2.4, 3.5, 17.1, 17.2, 17.3, 17.4, 17.5, 18.1, 18.2, 18.3, 18.4, 18.5_
  
  - [ ]* 5.2 Write property test for flexible providers accepting custom models
    - **Property 7: Flexible Providers Accept Custom Models**
    - **Validates: Requirements 1.4, 2.1, 2.4**
    - Test that ollama, openai_compatible, lm_studio_local accept arbitrary model names
    - Use fast-check to generate arbitrary model names
  
  - [ ]* 5.3 Write property test for restricted providers rejecting custom models
    - **Property 8: Restricted Providers Reject Custom Models**
    - **Validates: Requirements 2.2, 2.3**
    - Test that claude_code_subscription, zhipu reject unknown model names
    - Verify null is returned for invalid custom models
  
  - [ ]* 5.4 Write unit tests for resolveModelArg()
    - Test exact match in hardcoded map (with provider prefix)
    - Test exact match in hardcoded map (model_id only)
    - Test custom model with flexible provider (openai_compatible)
    - Test custom model with flexible provider (ollama)
    - Test custom model with flexible provider (lm_studio_local)
    - Test custom model rejected for restricted provider (claude_code_subscription)
    - Test custom model rejected for restricted provider (zhipu)
    - Test freeform name defaults to openai_compatible
    - Test provider/model parsing (split on first "/" only)
    - _Requirements: 1.4, 2.3, 2.4, 17.1, 17.2, 17.3, 17.4, 17.5, 18.1, 18.2, 18.3, 18.4_

- [x] 6. Update UI feedback for custom models
  - [x] 6.1 Update /model command confirmation message
    - Display "(custom)" suffix when custom_model_name is present
    - Distinguish between standard and custom models in output
    - _Requirements: 11.1, 11.2, 11.5_
  
  - [x] 6.2 Update /config command output
    - Show custom model indicator when applicable
    - Display current provider, model, and base URL
    - _Requirements: 11.3, 11.5_
  
  - [ ]* 6.3 Write unit tests for UI feedback
    - Test confirmation message includes "(custom)" for custom models
    - Test confirmation message excludes "(custom)" for standard models
    - Test /config displays custom model indicator correctly
    - _Requirements: 11.1, 11.2, 11.3, 11.5_

- [ ] 7. Add error handling for invalid configurations
  - [x] 7.1 Add validation in resolveModelArg()
    - Validate provider is non-empty string
    - Validate model_id is non-empty string
    - Validate custom_model_name is non-empty if present
    - Reject custom_model_name for restricted providers
    - _Requirements: 12.1, 12.2, 25.1, 25.2, 25.3, 25.4, 25.5_
  
  - [x] 7.2 Improve error messages in bin/agent.mjs
    - Display descriptive error for unknown provider
    - Display error with valid models list for restricted providers
    - Display error for empty model names
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  
  - [ ]* 7.3 Write unit tests for error handling
    - Test error thrown for unknown provider
    - Test error message includes provider name
    - Test error for invalid model_id includes model_id and provider
    - Test empty custom_model_name falls back gracefully
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [ ] 8. Checkpoint - Verify custom model support works correctly
  - Ensure all tests pass
  - Manually test: select custom ollama model, verify it's used in API calls
  - Manually test: select custom openai_compatible model, verify it works
  - Manually test: try custom model with restricted provider, verify error
  - Ask the user if questions arise

### Phase 3: Model Discovery

- [ ] 9. Implement model discovery service
  - [x] 9.1 Create lib/modelDiscovery.mjs module
    - Implement discoverOllamaModels(baseUrl, options) function
    - Construct discovery URL by removing trailing slashes and appending /api/tags
    - Make HTTP GET request with timeout (default 5000ms)
    - Parse JSON response and validate structure (models array exists)
    - Extract model information (name, size, modified_at, digest, details)
    - Return DiscoveryResult object with success flag and models/error
    - Handle connection errors, timeouts, HTTP errors, malformed responses
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 15.1, 15.2, 15.3, 15.4, 16.1, 16.2, 16.3, 16.4, 16.5, 21.1, 21.2, 21.3, 21.4, 21.5, 23.1, 23.2, 23.3, 23.4, 23.5_
  
  - [x] 9.2 Implement formatModelList() function
    - Format model list for display with names and sizes
    - Sort models by modification date (newest first) by default
    - Support sorting by name or size via options
    - Format byte sizes in human-readable format (B, KB, MB, GB)
    - Include verbose mode with parameter size and quantization level
    - Add usage instructions at the end
    - Handle empty models array with appropriate message
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 22.1, 22.2, 22.3, 22.4, 22.5_
  
  - [ ]* 9.3 Write property test for discovery response validation
    - **Property 11: Model Discovery Returns Valid Models**
    - **Validates: Requirements 7.2, 16.1, 16.2, 16.3**
    - Test that all returned models have non-empty name fields
    - Use fast-check to generate discovery responses
  
  - [ ]* 9.4 Write property test for discovery timeout handling
    - **Property 12: Discovery Timeout Handling**
    - **Validates: Requirements 7.4, 15.2, 15.3, 15.4**
    - Test that discovery respects timeout and returns error
    - Verify elapsed time is within timeout + small buffer
  
  - [ ]* 9.5 Write unit tests for discoverOllamaModels()
    - Test successful discovery with valid response
    - Test connection error handling (server unreachable)
    - Test timeout handling (slow server)
    - Test malformed response handling (missing models array)
    - Test malformed response handling (invalid model objects)
    - Test empty models array handling
    - Test HTTP error status codes (404, 500, etc.)
    - Test URL construction (trailing slash handling)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 15.1, 15.2, 15.3, 16.1, 16.2, 16.3, 16.4, 16.5, 21.1, 21.2, 21.3, 21.4, 21.5, 23.1, 23.2, 23.3, 23.4, 23.5_
  
  - [ ]* 9.6 Write unit tests for formatModelList()
    - Test formatting with multiple models
    - Test formatting with empty models array
    - Test sorting by modification date
    - Test sorting by name
    - Test sorting by size
    - Test verbose mode with details
    - Test byte size formatting (B, KB, MB, GB)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 22.1, 22.2, 22.3, 22.4, 22.5_

- [ ] 10. Add provider discovery capabilities
  - [x] 10.1 Update PROVIDER_CAPABILITIES in lib/modelConfig.mjs
    - Add supportsDiscovery field to provider capabilities
    - Set supportsDiscovery: true for ollama with discoveryEndpoint: '/api/tags'
    - Set supportsDiscovery: false for all other providers
    - Export supportsDiscovery() helper function
    - _Requirements: 7.1, 9.4, 9.5_
  
  - [ ]* 10.2 Write unit tests for discovery capabilities
    - Test supportsDiscovery returns true for ollama
    - Test supportsDiscovery returns false for other providers
    - Test discoveryEndpoint is set correctly for ollama
    - _Requirements: 9.4, 9.5_

- [ ] 11. Implement /models command in bin/agent.mjs
  - [x] 11.1 Add /models command handler
    - Get current provider and base URL from settings
    - Check if provider supports discovery using supportsDiscovery()
    - If not supported: display error with list of supported providers and guidance
    - If supported: call discoverOllamaModels() with base URL and timeout
    - On success: format and display model list using formatModelList()
    - On error: display error message with troubleshooting guidance
    - Handle connection errors with specific troubleshooting tips
    - _Requirements: 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3_
  
  - [x] 11.2 Add getBaseUrlForProvider() helper function
    - Resolve base URL for ollama provider (default: http://localhost:11434)
    - Use base_url from settings if present
    - Support other providers as needed
    - _Requirements: 7.1, 21.1, 21.2, 21.3, 21.4, 21.5_
  
  - [ ]* 11.3 Write integration tests for /models command
    - Test /models with ollama provider (mock successful response)
    - Test /models with ollama provider (mock connection error)
    - Test /models with ollama provider (mock timeout)
    - Test /models with non-ollama provider (expect error)
    - Test /models with no provider configured (expect error)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 9.1, 9.2, 9.3_

- [ ] 12. Add error handling for discovery edge cases
  - [x] 12.1 Handle discovery with unsupported provider
    - Check provider capabilities before attempting discovery
    - Display clear error message indicating discovery not supported
    - List providers that support discovery
    - Provide guidance for manual model selection
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  
  - [ ]* 12.2 Write property test for discovery only with supported providers
    - **Property 13: Discovery Only for Supported Providers**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
    - Test that discovery fails with clear error for unsupported providers
    - Verify error message includes provider name
  
  - [ ]* 12.3 Write unit tests for discovery error scenarios
    - Test discovery with unsupported provider (openai_compatible)
    - Test discovery with unsupported provider (claude_code_subscription)
    - Test discovery with no provider configured
    - Test error message includes list of supported providers
    - Test error message includes guidance for manual selection
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [ ] 13. Final checkpoint - Verify complete feature works end-to-end
  - Ensure all tests pass
  - Manually test: run /models with ollama, verify models are listed
  - Manually test: select a discovered model, verify it's used in API calls
  - Manually test: run /models with non-ollama provider, verify error
  - Manually test: restart ona, verify model selection is preserved
  - Ask the user if questions arise

## Notes

- **Tasks marked with `*` are optional** and can be skipped for faster MVP delivery
- **Phase 1 is CRITICAL** and must be completed first - it fixes a bug affecting all users
- **Phase 2 and Phase 3** can be implemented together or sequentially after Phase 1
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at major milestones
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Integration tests validate end-to-end workflows

## Implementation Priority

1. **Phase 1 (Tasks 1-2)**: Fix persistence bug - CRITICAL, affects all users
2. **Phase 2 (Tasks 3-8)**: Enable custom model support - HIGH priority, core feature
3. **Phase 3 (Tasks 9-13)**: Add model discovery - MEDIUM priority, UX improvement

## Testing Strategy

- **Property-based tests** use fast-check library to validate universal properties
- **Unit tests** validate individual functions with specific examples
- **Integration tests** validate end-to-end workflows and command interactions
- **Manual testing** at checkpoints ensures real-world usability

## Success Criteria

- Settings persist across ona restarts (Phase 1)
- Users can select arbitrary Ollama models without editing config files (Phase 2)
- Users can discover available models via /models command (Phase 3)
- All existing model configurations continue to work (backward compatibility)
- All tests pass with >90% code coverage
