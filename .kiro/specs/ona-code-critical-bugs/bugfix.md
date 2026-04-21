# Bugfix Requirements Document

## Introduction

The ona-code system has critical bugs in its authentication subsystem that violate the clean room specification and compromise user security. The primary bug involves the `/logout` command destructively clearing ALL credentials instead of only clearing "Claude.ai–sourced OAuth session material" as specified in §2.7.1 A4. This caused a user's ZAI_API_KEY to be destroyed when they ran `/logout` to clear Anthropic credentials, breaking their working setup. Additionally, the entire authentication subsystem (§2.7-2.8) lacks behavioral tests, which allowed these bugs to slip through. The root cause is LLM implementation that failed to follow the clean room specification combined with critical gaps in test coverage.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `/logout` command is executed THEN the system destructively clears ALL credentials including ZAI_API_KEY and other non-Anthropic credentials

1.2 WHEN `/logout` command calls `clearSecureCredentials()` THEN the system deletes the entire secure file instead of only Claude.ai-sourced OAuth session material

1.3 WHEN authentication commands (`/login`, `/logout`, `/status`) are executed THEN the system has no behavioral tests to validate correct behavior

1.4 WHEN the test suite runs THEN the system is missing `test_section_2_7_authentication.sh` and `test_section_2_8_credential_storage.sh` files

### Expected Behavior (Correct)

2.1 WHEN `/logout` command is executed THEN the system SHALL only clear "Claude.ai–sourced OAuth session material" as specified in clean room spec §2.7.1 A4

2.2 WHEN `/logout` command processes credentials THEN the system SHALL preserve ZAI_API_KEY and other non-Anthropic credentials

2.3 WHEN authentication commands are executed THEN the system SHALL have comprehensive behavioral tests validating all authentication flows

2.4 WHEN the test suite runs THEN the system SHALL include `test_section_2_7_authentication.sh` and `test_section_2_8_credential_storage.sh` with full coverage

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `/login` command is executed with valid Anthropic credentials THEN the system SHALL CONTINUE TO authenticate successfully and store Claude.ai session material

3.2 WHEN `/status` command is executed THEN the system SHALL CONTINUE TO display current authentication status for all credential types

3.3 WHEN ZAI_API_KEY is set independently THEN the system SHALL CONTINUE TO preserve and use it for non-Anthropic API calls

3.4 WHEN other authentication flows are used THEN the system SHALL CONTINUE TO function as specified in the clean room specification