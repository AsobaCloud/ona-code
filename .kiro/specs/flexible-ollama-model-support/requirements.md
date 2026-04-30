# Requirements Document: Flexible Ollama Model Support

## Introduction

This document specifies the requirements for enabling flexible model support in the ona CLI tool, with a focus on Ollama integration. The feature addresses three critical needs:

1. **Custom Model Names**: Support for arbitrary model names without requiring hardcoded entries in the model configuration map
2. **Model Discovery**: Automatic discovery of available models from Ollama servers
3. **Persistent Settings**: Reliable preservation of model selections across ona restarts

The system must maintain backward compatibility with existing model configurations while enabling local-first users to seamlessly work with any Ollama model.

## Glossary

- **Settings_Manager**: The component responsible for loading, merging, and persisting settings across sessions
- **Model_Resolver**: The component that determines the actual model name to send in API calls
- **Model_Discovery_Service**: The component that queries Ollama servers for available models
- **REPL**: The Read-Eval-Print Loop interface where users interact with ona
- **WIRE_Map**: The hardcoded mapping from logical model IDs to actual API model names
- **Custom_Model_Name**: An optional field in model configuration that specifies an arbitrary model name
- **Provider**: The backend service providing LLM capabilities (e.g., ollama, openai_compatible, claude_code_subscription)
- **Settings_Snapshot**: The database table storing the current effective settings
- **Bootstrap**: The initialization process that runs when ona starts
- **Runtime_Change**: A settings modification made during ona execution (e.g., via /model command)
- **File_Settings**: Settings loaded from .ona/settings.json or similar configuration files
- **Database_Settings**: Settings stored in the SQLite settings_snapshot table
- **Merge_Strategy**: The algorithm for combining settings from multiple sources with correct precedence

## Requirements

### Requirement 1: Custom Model Name Support

**User Story:** As a local-first user, I want to use arbitrary Ollama model names without editing configuration files, so that I can quickly switch between any models I have installed.

#### Acceptance Criteria

1. WHEN a model configuration contains a non-empty custom_model_name field, THE Model_Resolver SHALL return the custom_model_name value
2. WHEN a model configuration has an empty or absent custom_model_name field, THE Model_Resolver SHALL return the value from the WIRE_Map
3. WHEN resolving a model for API calls, THE Model_Resolver SHALL check custom_model_name before consulting the WIRE_Map
4. WHEN a user selects a model not in the WIRE_Map with a flexible provider, THE REPL SHALL create a configuration with custom_model_name set
5. THE custom_model_name field SHALL be optional in model configurations

### Requirement 2: Provider Capability Differentiation

**User Story:** As a system architect, I want different providers to have different capabilities for custom models, so that the system enforces appropriate constraints for each backend service.

#### Acceptance Criteria

1. THE providers "openai_compatible", "ollama", and "lm_studio_local" SHALL support arbitrary custom model names
2. THE providers "claude_code_subscription" and "zhipu" SHALL require model names to exist in the WIRE_Map
3. WHEN a user attempts to use a custom model name with a restricted provider, THE REPL SHALL reject the request with a descriptive error
4. WHEN a user attempts to use a custom model name with a flexible provider, THE REPL SHALL accept the request and create appropriate configuration
5. THE system SHALL maintain a provider capabilities map indicating which providers support custom models

### Requirement 3: Backward Compatibility Preservation

**User Story:** As an existing ona user, I want my current model configurations to continue working unchanged, so that the upgrade does not disrupt my workflow.

#### Acceptance Criteria

1. WHEN a model configuration uses only provider and model_id fields (no custom_model_name), THE Model_Resolver SHALL produce identical output to the previous implementation
2. WHEN resolving standard models from the WIRE_Map, THE system SHALL use the same resolution logic as before
3. WHEN the lm_studio_local provider is used, THE system SHALL continue to respect the LM_STUDIO_MODEL environment variable
4. WHEN existing settings files are loaded, THE system SHALL correctly interpret configurations without custom_model_name
5. THE /model command SHALL continue to accept all previously valid model names

### Requirement 4: Settings Persistence Across Sessions

**User Story:** As a user, I want my model selection to persist across ona restarts, so that I don't have to reconfigure my model every time I start ona.

#### Acceptance Criteria

1. WHEN a user sets a model via the /model command, THE Settings_Manager SHALL store the configuration in the database with source='runtime'
2. WHEN ona starts and the database contains settings newer than any settings file, THE Settings_Manager SHALL use the database settings unchanged
3. WHEN ona starts and no database exists, THE Settings_Manager SHALL initialize from settings files or defaults and write to the database
4. WHEN ona starts multiple times without changes, THE Settings_Manager SHALL return identical settings on each startup
5. THE database settings SHALL include an updated_at timestamp for precedence comparison

### Requirement 5: Manual File Edit Respect

**User Story:** As a power user, I want to manually edit settings files and have those changes respected, so that I can configure ona through version-controlled configuration files.

#### Acceptance Criteria

1. WHEN a settings file is modified after the last database update, THE Settings_Manager SHALL detect the newer file timestamp
2. WHEN a settings file is newer than the database, THE Settings_Manager SHALL merge file settings into the database
3. WHEN merging file and database settings, THE Settings_Manager SHALL give precedence to file settings for conflicting keys
4. WHEN multiple settings files exist, THE Settings_Manager SHALL merge all files and use the newest file timestamp for comparison
5. WHEN a settings file is corrupted or contains invalid JSON, THE Settings_Manager SHALL skip that file and continue with other sources

### Requirement 6: Settings Merge Strategy

**User Story:** As a system operator, I want settings to be merged from multiple sources with clear precedence rules, so that the system behavior is predictable and debuggable.

#### Acceptance Criteria

1. WHEN merging settings on first run, THE Settings_Manager SHALL use precedence: File > Defaults
2. WHEN merging settings with a newer file, THE Settings_Manager SHALL use precedence: File > Database > Defaults
3. WHEN merging settings with an older or absent file, THE Settings_Manager SHALL use precedence: Database (unchanged)
4. WHEN writing merged settings to the database, THE Settings_Manager SHALL include a source field indicating the merge reason
5. THE Settings_Manager SHALL perform deep merging of nested objects rather than shallow replacement

### Requirement 7: Model Discovery for Ollama

**User Story:** As an Ollama user, I want to see a list of available models on my server, so that I can discover and select models without memorizing exact names.

#### Acceptance Criteria

1. WHEN a user executes the /models command with an ollama provider, THE Model_Discovery_Service SHALL query the /api/tags endpoint
2. WHEN the Ollama server responds successfully, THE Model_Discovery_Service SHALL parse the models array and return model information
3. WHEN the Ollama server is unreachable, THE Model_Discovery_Service SHALL return an error with connection troubleshooting guidance
4. WHEN the discovery request exceeds the timeout duration, THE Model_Discovery_Service SHALL abort the request and return a timeout error
5. WHEN the Ollama server returns a malformed response, THE Model_Discovery_Service SHALL validate the structure and return a descriptive error

### Requirement 8: Model Discovery Display

**User Story:** As a user, I want discovered models to be displayed in a clear, readable format, so that I can easily identify and select the model I need.

#### Acceptance Criteria

1. WHEN displaying discovered models, THE REPL SHALL show model name and size for each model
2. WHEN displaying discovered models, THE REPL SHALL sort models by modification date (newest first) by default
3. WHEN displaying discovered models, THE REPL SHALL include usage instructions for selecting a model
4. WHEN the models list is empty, THE REPL SHALL display a message indicating no models were found
5. WHEN verbose mode is enabled, THE REPL SHALL include parameter size and quantization level in the display

### Requirement 9: Provider-Specific Discovery Support

**User Story:** As a user of non-Ollama providers, I want clear feedback when model discovery is not available, so that I understand the limitations of my current provider.

#### Acceptance Criteria

1. WHEN a user executes /models with a provider that does not support discovery, THE REPL SHALL display an error message
2. WHEN displaying the discovery error, THE REPL SHALL list which providers support discovery
3. WHEN displaying the discovery error, THE REPL SHALL provide guidance for manual model selection with the current provider
4. THE system SHALL maintain a provider capabilities map indicating which providers support discovery
5. THE ollama provider SHALL be the only provider with discovery support in the initial implementation

### Requirement 10: Model Resolution for API Calls

**User Story:** As a developer, I want the system to send the correct model name in API calls, so that the backend service receives valid requests.

#### Acceptance Criteria

1. WHEN making an API call, THE system SHALL resolve the model name using Model_Resolver
2. WHEN the resolved model name is obtained, THE system SHALL include it in the API request body's model field
3. WHEN custom_model_name is present, THE resolved model name SHALL equal custom_model_name
4. WHEN custom_model_name is absent, THE resolved model name SHALL equal the WIRE_Map value for the model_id
5. THE resolved model name SHALL be a non-empty string

### Requirement 11: User Interface Feedback

**User Story:** As a user, I want clear feedback when I change models, so that I can confirm my selection was successful.

#### Acceptance Criteria

1. WHEN a user successfully sets a model, THE REPL SHALL display a confirmation message with provider and model name
2. WHEN a model uses custom_model_name, THE REPL SHALL indicate it is a custom model in the confirmation
3. WHEN a user executes /config, THE REPL SHALL display the current provider, model, and base URL
4. WHEN a model selection fails, THE REPL SHALL display a descriptive error message
5. WHEN displaying model information, THE REPL SHALL distinguish between standard and custom models

### Requirement 12: Error Handling for Invalid Configurations

**User Story:** As a user, I want helpful error messages when I provide invalid model configurations, so that I can quickly correct my mistakes.

#### Acceptance Criteria

1. WHEN a user specifies an unknown provider, THE Model_Resolver SHALL throw an error with the provider name
2. WHEN a user specifies an invalid model_id for a restricted provider, THE REPL SHALL display an error listing valid models
3. WHEN a custom model name is empty or whitespace-only, THE Model_Resolver SHALL fall back to WIRE_Map lookup
4. WHEN the WIRE_Map lookup fails, THE Model_Resolver SHALL throw an error with the model_id and provider
5. WHEN the LM_STUDIO_MODEL environment variable is not set for lm_studio_local, THE Model_Resolver SHALL throw a descriptive error

### Requirement 13: Database Schema Support

**User Story:** As a system architect, I want the database schema to support the new persistence requirements, so that settings can be reliably stored and retrieved.

#### Acceptance Criteria

1. THE settings_snapshot table SHALL have a scope column for identifying the settings type
2. THE settings_snapshot table SHALL have a json column for storing serialized settings
3. THE settings_snapshot table SHALL have an updated_at column for timestamp tracking
4. THE settings_snapshot table SHALL optionally have a source column for debugging merge operations
5. THE Settings_Manager SHALL use the 'effective' scope for current settings

### Requirement 14: Timestamp Comparison Accuracy

**User Story:** As a system operator, I want accurate timestamp comparisons between files and database, so that the merge strategy works correctly.

#### Acceptance Criteria

1. WHEN comparing timestamps, THE Settings_Manager SHALL use file modification time (mtime) for files
2. WHEN comparing timestamps, THE Settings_Manager SHALL use the updated_at field for database settings
3. WHEN a file timestamp is newer than the database timestamp, THE Settings_Manager SHALL consider the file as modified
4. WHEN a file does not exist, THE Settings_Manager SHALL treat its timestamp as null (older than any database timestamp)
5. WHEN multiple files exist, THE Settings_Manager SHALL use the newest file timestamp for comparison

### Requirement 15: Discovery Timeout Configuration

**User Story:** As a user with a slow network, I want the discovery timeout to be reasonable, so that I don't wait indefinitely for unresponsive servers.

#### Acceptance Criteria

1. THE Model_Discovery_Service SHALL use a default timeout of 5000 milliseconds
2. WHEN a discovery request exceeds the timeout, THE Model_Discovery_Service SHALL abort the request
3. WHEN a timeout occurs, THE Model_Discovery_Service SHALL return a DiscoveryResult with success: false
4. WHEN a timeout occurs, THE error message SHALL indicate the timeout duration
5. THE timeout SHALL be configurable via function parameters

### Requirement 16: Discovery Response Validation

**User Story:** As a developer, I want the system to validate discovery responses, so that malformed data doesn't cause crashes or incorrect behavior.

#### Acceptance Criteria

1. WHEN parsing a discovery response, THE Model_Discovery_Service SHALL verify the models field exists
2. WHEN parsing a discovery response, THE Model_Discovery_Service SHALL verify models is an array
3. WHEN parsing model entries, THE Model_Discovery_Service SHALL verify each model has a non-empty name field
4. WHEN a model entry is invalid, THE Model_Discovery_Service SHALL skip that entry and continue processing
5. WHEN the entire response is invalid, THE Model_Discovery_Service SHALL return an error with a descriptive message

### Requirement 17: Model Name Parsing

**User Story:** As a user, I want to specify models using provider/model syntax, so that I can clearly indicate which provider and model I want to use.

#### Acceptance Criteria

1. WHEN a user provides input containing "/", THE REPL SHALL parse it as provider/model format
2. WHEN parsing provider/model format, THE REPL SHALL split on the first "/" character only
3. WHEN a parsed model matches a WIRE_Map entry, THE REPL SHALL use the standard configuration
4. WHEN a parsed model does not match the WIRE_Map and the provider is flexible, THE REPL SHALL create a custom model configuration
5. WHEN a parsed model does not match the WIRE_Map and the provider is restricted, THE REPL SHALL reject the input

### Requirement 18: Freeform Model Name Handling

**User Story:** As a user, I want to specify model names without a provider prefix, so that I can quickly select models with minimal typing.

#### Acceptance Criteria

1. WHEN a user provides input without "/", THE REPL SHALL first search the WIRE_Map for a matching model_id
2. WHEN a WIRE_Map match is found, THE REPL SHALL use that model's configuration
3. WHEN no WIRE_Map match is found, THE REPL SHALL assume openai_compatible provider with custom model name
4. WHEN creating a freeform custom model, THE REPL SHALL set both model_id and custom_model_name to the input value
5. THE freeform fallback behavior SHALL maintain backward compatibility with existing lm_studio_local usage

### Requirement 19: Settings Source Tracking

**User Story:** As a system operator debugging settings issues, I want to know where settings came from, so that I can understand why certain values are active.

#### Acceptance Criteria

1. WHEN settings are written to the database on first run, THE Settings_Manager SHALL set source to "bootstrap-first-run"
2. WHEN settings are written due to a newer file, THE Settings_Manager SHALL set source to "bootstrap-file-newer"
3. WHEN settings are preserved from the database, THE Settings_Manager SHALL set source to "bootstrap-db-preserved"
4. WHEN settings are updated via runtime commands, THE Settings_Manager SHALL set source to "runtime"
5. THE source field SHALL be optional for backward compatibility with existing databases

### Requirement 20: Deep Merge Behavior

**User Story:** As a user with complex settings, I want nested settings objects to be merged intelligently, so that I don't lose unrelated configuration when updating one field.

#### Acceptance Criteria

1. WHEN merging two settings objects, THE Settings_Manager SHALL recursively merge nested objects
2. WHEN a key exists in both objects and both values are objects, THE Settings_Manager SHALL merge the nested objects
3. WHEN a key exists in both objects and either value is not an object, THE Settings_Manager SHALL use the higher-precedence value
4. WHEN a key exists only in one object, THE Settings_Manager SHALL include it in the merged result
5. THE merge operation SHALL not modify the input objects (immutable merge)

### Requirement 21: Discovery URL Construction

**User Story:** As a user with a custom Ollama base URL, I want discovery to work correctly regardless of trailing slashes, so that I don't have to worry about URL formatting.

#### Acceptance Criteria

1. WHEN constructing the discovery URL, THE Model_Discovery_Service SHALL remove trailing slashes from the base URL
2. WHEN appending the endpoint path, THE Model_Discovery_Service SHALL add exactly one "/" separator
3. WHEN the base URL is "http://localhost:11434", THE discovery URL SHALL be "http://localhost:11434/api/tags"
4. WHEN the base URL is "http://localhost:11434/", THE discovery URL SHALL be "http://localhost:11434/api/tags"
5. THE URL construction SHALL handle both cases identically

### Requirement 22: Model Size Formatting

**User Story:** As a user viewing model lists, I want model sizes displayed in human-readable format, so that I can quickly understand storage requirements.

#### Acceptance Criteria

1. WHEN formatting model sizes less than 1024 bytes, THE REPL SHALL display the value in bytes (B)
2. WHEN formatting model sizes less than 1 MB, THE REPL SHALL display the value in kilobytes (KB) with one decimal place
3. WHEN formatting model sizes less than 1 GB, THE REPL SHALL display the value in megabytes (MB) with one decimal place
4. WHEN formatting model sizes 1 GB or larger, THE REPL SHALL display the value in gigabytes (GB) with one decimal place
5. THE size formatting SHALL use 1024 as the conversion factor (binary units)

### Requirement 23: Discovery HTTP Error Handling

**User Story:** As a user, I want clear error messages when the Ollama server returns HTTP errors, so that I can diagnose server-side issues.

#### Acceptance Criteria

1. WHEN the Ollama server returns a non-200 status code, THE Model_Discovery_Service SHALL return an error result
2. WHEN an HTTP error occurs, THE error message SHALL include the status code
3. WHEN a 404 error occurs, THE error message SHALL indicate the endpoint was not found
4. WHEN a 500 error occurs, THE error message SHALL indicate a server error
5. THE Model_Discovery_Service SHALL not throw exceptions for HTTP errors (return error result instead)

### Requirement 24: Settings File Search Order

**User Story:** As a user, I want settings to be loaded from multiple possible locations, so that I can organize my configuration files according to my preferences.

#### Acceptance Criteria

1. THE Settings_Manager SHALL search for settings in .ona/settings.json relative to project root
2. THE Settings_Manager SHALL search for settings in .claude/settings.local.json relative to project root
3. THE Settings_Manager SHALL search for settings in settings.json relative to project root
4. WHEN multiple settings files exist, THE Settings_Manager SHALL merge all found files
5. THE Settings_Manager SHALL skip files that do not exist or cannot be read

### Requirement 25: Model Configuration Validation

**User Story:** As a developer, I want model configurations to be validated before use, so that invalid configurations are caught early.

#### Acceptance Criteria

1. WHEN validating a model configuration, THE system SHALL verify provider is a non-empty string
2. WHEN validating a model configuration, THE system SHALL verify model_id is a non-empty string
3. WHEN custom_model_name is present, THE system SHALL verify it is a non-empty string
4. WHEN custom_model_name is present for a restricted provider, THE system SHALL reject the configuration
5. THE validation SHALL occur before storing the configuration in the database

## Non-Functional Requirements

### Performance Requirements

1. **Settings Load Time**: Settings bootstrap SHALL complete within 100ms for typical configurations
2. **Model Discovery Time**: Model discovery SHALL complete within 5 seconds or timeout gracefully
3. **Database Operations**: Settings read/write operations SHALL complete within 10ms
4. **Memory Usage**: Settings objects SHALL not exceed 1MB in serialized form

### Security Requirements

1. **Input Validation**: All user-provided model names SHALL be validated before use in API calls
2. **SQL Injection Prevention**: All database operations SHALL use parameterized queries
3. **File System Access**: Settings file reads SHALL be restricted to the project root directory
4. **Environment Variables**: Sensitive environment variables SHALL not be logged or displayed

### Compatibility Requirements

1. **Node.js Version**: The system SHALL support Node.js 18.0.0 and later
2. **SQLite Version**: The system SHALL support SQLite 3.35.0 and later
3. **Ollama API Version**: The system SHALL support Ollama API v1 (current stable)
4. **Existing Configurations**: The system SHALL maintain 100% backward compatibility with existing settings files

### Reliability Requirements

1. **Graceful Degradation**: When discovery fails, users SHALL still be able to manually specify models
2. **Data Integrity**: Settings SHALL never be corrupted by concurrent access or crashes
3. **Error Recovery**: Invalid settings files SHALL not prevent ona from starting
4. **Idempotency**: Multiple startups without changes SHALL produce identical settings

### Usability Requirements

1. **Error Messages**: All error messages SHALL include actionable guidance for resolution
2. **Confirmation Feedback**: All successful operations SHALL provide clear confirmation to the user
3. **Discovery Output**: Model lists SHALL be formatted for easy scanning and selection
4. **Help Text**: The /models command SHALL include usage instructions in its output

### Maintainability Requirements

1. **Code Organization**: Settings persistence logic SHALL be isolated in a dedicated module
2. **Testing**: All core functions SHALL have unit tests with >90% code coverage
3. **Documentation**: All public functions SHALL have JSDoc comments with preconditions and postconditions
4. **Logging**: Settings merge decisions SHALL be logged for debugging purposes
