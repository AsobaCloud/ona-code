# Complete Behavioral Test Coverage Design

## Overview

This design translates the requirements for comprehensive behavioral test coverage into a technical implementation plan. The feature implements behavioral tests for 8 uncovered specification sections to achieve 100% coverage of 99 normative requirements in CLEAN_ROOM_SPEC.md.

The design follows a systematic approach:
1. **Test Architecture**: Establish patterns and utilities for behavioral testing
2. **Section-by-Section Implementation**: Create tests for each uncovered section
3. **Coverage Tracking**: Implement automated coverage validation
4. **Integration**: Integrate with existing test infrastructure
5. **Maintenance**: Establish processes for ongoing coverage

## Glossary

- **Test_Architecture**: The framework, utilities, and patterns used to create behavioral tests
- **Coverage_Matrix**: A mapping of normative requirements to test files and pass/fail status
- **Test_Fixture**: Reusable test data, database state, or configuration
- **Hook_Event**: One of 24 event types that trigger hook execution
- **Permission_Rule**: A specification in Appendix E controlling tool access
- **Phase_Transition**: A state change in conversations.phase
- **Test_Template**: A standardized pattern for behavioral tests
- **Epistemic_Isolation**: Test generators must not access implementation source files
- **Observable_State**: System state that tests can verify (DB, files, output, tools, hooks)
- **Normative_Requirement**: A "must", "shall", "required", or "forbidden" statement in CLEAN_ROOM_SPEC.md

## Design Decisions

### 1. Test Organization by Specification Section

**Decision**: Organize tests into separate files by specification section (section-2.6-*.sh, section-4.7-*.sh, etc.)

**Rationale**:
- Mirrors the structure of CLEAN_ROOM_SPEC.md for easy navigation
- Allows independent test execution for specific sections
- Simplifies maintenance and updates when specification sections change
- Enables parallel test development across sections

**Implementation**:
- Create 8 new test files in `tests/spec-behavioral/`
- Each file contains tests for one specification section
- Tests within each file follow a consistent naming pattern

### 2. Test Fixture Management

**Decision**: Create a centralized fixture library in `tests/spec-behavioral/lib/fixtures.sh`

**Rationale**:
- Reduces duplication across test files
- Ensures consistent test data across all tests
- Simplifies fixture updates and maintenance
- Enables easy fixture reuse and composition

**Implementation**:
- Define fixture functions for common scenarios:
  - `setup_clean_database()` - Creates clean AGENT_SDLC_DB
  - `setup_hook_configuration()` - Creates hook config with specified events
  - `setup_permission_rules()` - Creates permission rule configurations
  - `setup_file_system()` - Creates temporary test directories
  - `setup_environment()` - Isolates environment variables
- Each fixture includes setup and teardown functions
- Fixtures are sourced by test files as needed

### 3. Coverage Tracking System

**Decision**: Implement automated coverage tracking that maps requirements to tests

**Rationale**:
- Provides visibility into which requirements are tested
- Enables automated detection of coverage gaps
- Supports continuous verification of 100% coverage
- Facilitates maintenance as specification evolves

**Implementation**:
- Create `tests/spec-behavioral/coverage/coverage-tracker.sh` to:
  - Parse CLEAN_ROOM_SPEC.md for normative requirements
  - Extract section IDs and requirement text
  - Cross-reference against test files
  - Generate coverage matrix JSON
- Create `tests/spec-behavioral/coverage/validate-coverage.sh` to:
  - Verify all normative requirements have tests
  - Report coverage percentage
  - Identify uncovered requirements
  - Exit 0 if 100% coverage, exit 1 otherwise

### 4. Test Execution Order

**Decision**: Execute tests in specification section order (2.6 → 4.7 → 5.3 → 5.7 → 5.8 → 5.9 → 8.4 → 8.8)

**Rationale**:
- Follows logical progression through specification
- Allows tests to build on previous section coverage
- Simplifies debugging when tests fail
- Matches specification reading order

**Implementation**:
- Update `tests/spec-behavioral/run-all.sh` to include new tests in order
- Maintain existing test execution order for sections 1, 2.4, 4.*, 8.1
- New tests execute after existing tests to preserve baseline

### 5. Behavioral Test Patterns

**Decision**: Use standardized test patterns from §8.8 behavioral test templates

**Rationale**:
- Ensures consistency across all tests
- Follows specification requirements for test structure
- Enables automated validation of test quality
- Simplifies test maintenance and updates

**Implementation**:
- Each test follows one of 35 normative test templates
- Tests target observable system state (DB, files, output, tools, hooks)
- Tests do NOT mock or stub implementation modules
- Tests exercise real code paths
- Tests include clear assertions and error messages

### 6. Integration with Existing Infrastructure

**Decision**: Integrate new tests with existing test runner and CI/CD pipeline

**Rationale**:
- Maintains consistency with existing test infrastructure
- Enables automated testing in CI/CD
- Simplifies deployment and verification
- Reduces maintenance burden

**Implementation**:
- New tests follow existing bash test template pattern
- Tests integrate with `run-all.sh` test runner
- Tests generate output compatible with existing reporting
- Tests maintain compatibility with CI/CD pipeline

## Correctness Properties

### Property 1: Comprehensive Specification Coverage

**Specification**: For any normative requirement in CLEAN_ROOM_SPEC.md that defines binding conformance behavior, the behavioral test suite SHALL include corresponding tests that validate compliance with that requirement.

**Validates**: Requirements 1.1-1.8 (all 8 uncovered sections)

**Test Strategy**:
- Parse CLEAN_ROOM_SPEC.md to extract all normative requirements
- For each requirement, verify at least one test exists
- For each test, verify it validates the corresponding requirement
- Generate coverage report showing 100% coverage (99/99 requirements)

**Success Criteria**:
- All 99 normative requirements have corresponding tests
- All tests pass
- Coverage report shows 100% coverage

### Property 2: Preservation of Existing Tests

**Specification**: For any existing behavioral test in sections 1, 2.4, 4.*, and 8.1, the enhanced test suite SHALL produce the same test results and validation behavior as the original test suite.

**Validates**: Requirements 3.1-3.4 (preservation)

**Test Strategy**:
- Execute all existing tests in original test suite
- Execute all existing tests in enhanced test suite
- Compare results to verify identical behavior
- Verify no regressions or side effects

**Success Criteria**:
- All 42 existing tests continue to pass
- Test results are identical between original and enhanced suites
- No regressions or side effects detected

### Property 3: Test Quality and Maintainability

**Specification**: All behavioral tests SHALL follow standardized patterns, target observable system state, exercise real code paths, and be maintainable and understandable.

**Validates**: Requirements 1.1-1.8 (test quality)

**Test Strategy**:
- Verify each test follows one of 35 normative test templates
- Verify each test targets observable system state (DB, files, output, tools, hooks)
- Verify each test does NOT mock or stub implementation modules
- Verify each test includes clear assertions and error messages
- Verify each test is documented and maintainable

**Success Criteria**:
- All tests follow standardized patterns
- All tests target observable system state
- All tests exercise real code paths
- All tests are documented and maintainable

## Implementation Architecture

### Test File Structure

```
tests/spec-behavioral/
├── section-2.6-sessionstart-hook.sh
├── section-4.7-memory-ranking.sh
├── section-5.3-hook-ordering.sh
├── section-5.7-permission-dialog.sh
├── section-5.8-async-hooks.sh
├── section-5.9-hook-timeouts.sh
├── section-8.4-operator-hooks.sh
├── section-8.8-test-templates.sh
├── lib/
│   ├── fixtures.sh (new)
│   ├── assertions.sh (new)
│   └── [existing utilities]
├── coverage/
│   ├── coverage-tracker.sh (new)
│   ├── validate-coverage.sh (new)
│   └── matrix.json (generated)
└── run-all.sh (updated)
```

### Test Fixture Architecture

```bash
# Fixture functions in tests/spec-behavioral/lib/fixtures.sh

setup_clean_database() {
  # Create clean AGENT_SDLC_DB with schema
  # Return path to database
}

setup_hook_configuration() {
  # Create hook config with specified events
  # Parameters: event_type, hook_ordinal, shell_command
  # Return path to config
}

setup_permission_rules() {
  # Create permission rule configurations
  # Parameters: rule_type, tool_name, decision
  # Return path to config
}

setup_file_system() {
  # Create temporary test directories
  # Return path to temp directory
}

setup_environment() {
  # Isolate environment variables
  # Save current env, set test env
  # Return cleanup function
}

teardown_fixture() {
  # Clean up fixture resources
  # Remove temp files, restore env
}
```

### Coverage Tracking Architecture

```bash
# Coverage tracking in tests/spec-behavioral/coverage/

coverage-tracker.sh:
  1. Parse CLEAN_ROOM_SPEC.md for normative requirements
  2. Extract section IDs and requirement text
  3. Cross-reference against test files
  4. Generate coverage matrix JSON
  5. Output: tests/spec-behavioral/coverage/matrix.json

validate-coverage.sh:
  1. Load coverage matrix
  2. For each requirement, verify test exists
  3. For each test, verify it passes
  4. Calculate coverage percentage
  5. Report uncovered requirements
  6. Exit 0 if 100% coverage, exit 1 otherwise
```

### Test Execution Flow

```
run-all.sh
├── Execute existing tests (sections 1, 2.4, 4.*, 8.1)
├── Execute new tests (sections 2.6, 4.7, 5.3, 5.7, 5.8, 5.9, 8.4, 8.8)
├── Run coverage-tracker.sh to generate matrix
├── Run validate-coverage.sh to verify 100% coverage
└── Report results
```

## Section-by-Section Implementation

### Section 2.6: SessionStart Hook Field Model

**Tests to Implement**:
1. Verify SessionStart hook includes all required fields
2. Verify source field values (user_initiated, auto_recovery, test_execution)
3. Verify JSON schema compliance
4. Verify no extra fields beyond schema
5. Verify all required fields present

**Test Fixtures**:
- Clean database with hook configuration
- SessionStart hook event trigger
- Expected stdin schema

**Observable State**:
- Hook stdin JSON structure
- Hook execution log
- Database hook_events table

### Section 4.7: Ranking/Import Rules for Memories

**Tests to Implement**:
1. Verify offline import into memories table is allowed
2. Verify ranking follows ARCHITECTURE.md rules
3. Verify authoritative reads do NOT come from shared-memory/.md
4. Verify higher-ranked memories are prioritized
5. Verify import rule violations are detected
6. Verify ranking is correctly applied

**Test Fixtures**:
- Clean database with memories table
- Sample memory files with rankings
- ARCHITECTURE.md reference rules

**Observable State**:
- memories table contents
- Memory ranking values
- Import operation results

### Section 5.3: Sequential Execution (Hook Ordering)

**Tests to Implement**:
1. Verify hooks execute in ascending hook_ordinal order
2. Verify duplicate ordinals are deduplicated (keep first)
3. Verify exit code 0 continues to next hook
4. Verify exit code 2 (blocking) skips remaining hooks
5. Verify other exit codes are non-blocking
6. Verify accumulated state passed to next hook
7. Verify ordering violations are detected

**Test Fixtures**:
- Multiple hooks with different ordinals
- Hook configurations with various exit codes
- Hook execution environment

**Observable State**:
- Hook execution order in logs
- Hook exit codes
- Accumulated state between hooks

### Section 5.7: PreToolUse Permission Dialog Flow

**Tests to Implement**:
1. Verify exit code 2 captures permission decision
2. Verify deny decision blocks tool call
3. Verify ask decision prompts operator
4. Verify allow decision proceeds
5. Verify precedence: deny > ask > allow
6. Verify decision persisted to database
7. Verify invalid permission data handled gracefully

**Test Fixtures**:
- PreToolUse hook configurations
- Permission rule configurations
- Tool call scenarios

**Observable State**:
- tool_permission_log table
- Hook exit codes and output
- Tool execution results

### Section 5.8: Async Hooks (Forbidden Pattern)

**Tests to Implement**:
1. Verify `{"async":true}` is rejected with error
2. Verify `{"async":false}` is accepted
3. Verify omitted async field defaults to false
4. Verify async execution is blocked
5. Verify error message indicates forbidden pattern
6. Verify validation happens before execution
7. Verify invalid config is rejected before execution

**Test Fixtures**:
- Hook configurations with async field variations
- Hook validation logic
- Error handling

**Observable State**:
- Hook validation results
- Error messages
- Hook execution status

### Section 5.9: Hook Timeouts

**Tests to Implement**:
1. Verify hook exceeding timeout is terminated
2. Verify hook completing within timeout is captured normally
3. Verify timeout is recorded in execution log
4. Verify error message includes [SDLC_INTERNAL] prefix
5. Verify timeout is non-blocking failure
6. Verify timeout value is respected
7. Verify system continues operation without hanging

**Test Fixtures**:
- Hooks with various execution times
- Timeout configuration
- Long-running hook simulation

**Observable State**:
- Hook execution logs
- Timeout values
- Process termination status

### Section 8.4: Operator Workflow Hooks

**Tests to Implement**:
1. Verify workflow hook registration
2. Verify hook receives correct event context
3. Verify hook result is applied to workflow state
4. Verify multiple hooks execute in correct order
5. Verify hook failure handling (blocking vs non-blocking)
6. Verify state modifications are persisted
7. Verify removed hooks no longer execute

**Test Fixtures**:
- Workflow hook configurations
- Workflow state scenarios
- Hook event contexts

**Observable State**:
- Workflow state in database
- Hook execution logs
- State modification results

### Section 8.8: Behavioral Test Templates

**Tests to Implement**:
1. Verify test follows one of 35 normative templates
2. Verify all required assertions are included
3. Verify test targets observable system state
4. Verify test does NOT mock/stub implementation
5. Verify test exercises real code paths
6. Verify test traces to plan success criterion
7. Verify test is maintainable and follows pattern

**Test Fixtures**:
- 35 normative test templates
- Test validation logic
- Plan success criteria

**Observable State**:
- Test structure and assertions
- Test execution results
- Coverage matrix

## Testing Strategy

### Validation Approach

The testing strategy follows a systematic approach:
1. **Specification Mapping**: Map all normative requirements to test categories
2. **Test Implementation**: Create behavioral tests for each requirement
3. **Coverage Verification**: Verify all requirements have corresponding tests
4. **Preservation Verification**: Verify existing tests continue to pass
5. **Integration Verification**: Verify tests integrate with existing infrastructure

### Test Execution

**Phase 1: Exploratory Testing**
- Run existing tests to establish baseline (42 tests, 88% coverage)
- Identify specific coverage gaps in 8 uncovered sections
- Document missing test scenarios

**Phase 2: Test Implementation**
- Implement tests for section 2.6 (7 tests)
- Implement tests for section 4.7 (6 tests)
- Implement tests for section 5.3 (7 tests)
- Implement tests for section 5.7 (7 tests)
- Implement tests for section 5.8 (7 tests)
- Implement tests for section 5.9 (7 tests)
- Implement tests for section 8.4 (7 tests)
- Implement tests for section 8.8 (7 tests)

**Phase 3: Coverage Verification**
- Run coverage-tracker.sh to generate matrix
- Run validate-coverage.sh to verify 100% coverage
- Verify all 99 requirements have tests
- Verify all tests pass

**Phase 4: Preservation Verification**
- Run all existing tests
- Verify 42 existing tests continue to pass
- Verify no regressions or side effects

**Phase 5: Integration Verification**
- Integrate new tests with run-all.sh
- Verify tests execute in correct order
- Verify tests integrate with CI/CD pipeline

### Success Criteria

**Coverage Success**:
- All 99 normative requirements have corresponding tests
- All tests pass
- Coverage report shows 100% coverage

**Preservation Success**:
- All 42 existing tests continue to pass
- No regressions or side effects
- Existing test infrastructure unchanged

**Quality Success**:
- All tests follow standardized patterns
- All tests target observable system state
- All tests exercise real code paths
- All tests are documented and maintainable

## Maintenance and Evolution

### Specification Change Process

When CLEAN_ROOM_SPEC.md is updated:
1. Parse updated specification for new normative requirements
2. Identify new requirements not covered by existing tests
3. Create new tests for new requirements
4. Update coverage matrix
5. Verify 100% coverage maintained

### Test Maintenance

- Review tests quarterly for relevance and accuracy
- Update tests when specification requirements change
- Refactor tests to improve maintainability
- Document test patterns and best practices

### Documentation

- Maintain test documentation in each test file
- Document fixture usage and patterns
- Document coverage matrix and tracking process
- Maintain README for test suite

## Risk Mitigation

### Risks and Mitigations

**Risk**: Tests become outdated as specification evolves
- **Mitigation**: Implement automated coverage tracking to detect gaps
- **Mitigation**: Establish process to update tests when spec changes

**Risk**: Tests are brittle and fail on unrelated changes
- **Mitigation**: Use observable system state, not implementation details
- **Mitigation**: Avoid mocking/stubbing implementation modules

**Risk**: Coverage tracking is inaccurate
- **Mitigation**: Implement automated parsing of specification
- **Mitigation**: Cross-reference tests against requirements
- **Mitigation**: Manual verification of coverage matrix

**Risk**: New tests break existing functionality
- **Mitigation**: Preserve all existing tests
- **Mitigation**: Verify existing tests continue to pass
- **Mitigation**: Run full test suite before deployment

## Deliverables

### Test Files
- `tests/spec-behavioral/section-2.6-sessionstart-hook.sh`
- `tests/spec-behavioral/section-4.7-memory-ranking.sh`
- `tests/spec-behavioral/section-5.3-hook-ordering.sh`
- `tests/spec-behavioral/section-5.7-permission-dialog.sh`
- `tests/spec-behavioral/section-5.8-async-hooks.sh`
- `tests/spec-behavioral/section-5.9-hook-timeouts.sh`
- `tests/spec-behavioral/section-8.4-operator-hooks.sh`
- `tests/spec-behavioral/section-8.8-test-templates.sh`

### Infrastructure Files
- `tests/spec-behavioral/lib/fixtures.sh` (new)
- `tests/spec-behavioral/lib/assertions.sh` (new)
- `tests/spec-behavioral/coverage/coverage-tracker.sh` (new)
- `tests/spec-behavioral/coverage/validate-coverage.sh` (new)
- `tests/spec-behavioral/run-all.sh` (updated)

### Documentation
- Test documentation in each test file
- Fixture usage documentation
- Coverage matrix and tracking documentation
- README for test suite

### Verification
- All 99 normative requirements have tests
- All tests pass
- Coverage report shows 100% coverage
- All 42 existing tests continue to pass
- Tests integrate with CI/CD pipeline
