# Implementation Tasks

## Overview

This plan systematically implements comprehensive behavioral tests for all 8 uncovered specification sections. The approach follows the requirements-first workflow: requirements define what needs to be tested, design defines how to test it, and tasks define the concrete implementation steps.

---

## Phase 1: Test Infrastructure Setup

- [ ] 1.1 Create test fixture library
  - **Objective**: Establish reusable test fixtures for all test files
  - **Tasks**:
    - Create `tests/spec-behavioral/lib/fixtures.sh`
    - Implement `setup_clean_database()` function
    - Implement `setup_hook_configuration()` function
    - Implement `setup_permission_rules()` function
    - Implement `setup_file_system()` function
    - Implement `setup_environment()` function
    - Implement `teardown_fixture()` function
    - Document fixture usage with examples
  - **Acceptance Criteria**:
    - All fixture functions are implemented and documented
    - Fixtures can be sourced by test files
    - Fixtures include setup and teardown
    - Fixtures are reusable across multiple tests
  - **Requirements**: Design section "Test Fixture Architecture"

- [ ] 1.2 Create test assertion library
  - **Objective**: Establish reusable assertions for behavioral validation
  - **Tasks**:
    - Create `tests/spec-behavioral/lib/assertions.sh`
    - Implement `assert_json_valid()` function
    - Implement `assert_field_exists()` function
    - Implement `assert_field_value()` function
    - Implement `assert_db_row_exists()` function
    - Implement `assert_db_row_count()` function
    - Implement `assert_file_contains()` function
    - Implement `assert_hook_executed()` function
    - Document assertion usage with examples
  - **Acceptance Criteria**:
    - All assertion functions are implemented and documented
    - Assertions provide clear error messages on failure
    - Assertions can be used across all test files
    - Assertions validate observable system state
  - **Requirements**: Design section "Test Execution Flow"

- [ ] 1.3 Create coverage tracking system
  - **Objective**: Implement automated coverage tracking and validation
  - **Tasks**:
    - Create `tests/spec-behavioral/coverage/coverage-tracker.sh`
    - Implement specification parsing for normative requirements
    - Implement requirement extraction (section ID, text, keywords)
    - Implement test file cross-referencing
    - Implement coverage matrix generation (JSON output)
    - Create `tests/spec-behavioral/coverage/validate-coverage.sh`
    - Implement coverage verification logic
    - Implement coverage percentage calculation
    - Implement uncovered requirement reporting
    - Document coverage tracking process
  - **Acceptance Criteria**:
    - coverage-tracker.sh generates accurate coverage matrix
    - validate-coverage.sh correctly identifies coverage gaps
    - Coverage matrix includes all 99 normative requirements
    - Coverage percentage is calculated correctly
    - Uncovered requirements are clearly reported
  - **Requirements**: Design section "Coverage Tracking Architecture"

- [ ] 1.4 Update test runner
  - **Objective**: Integrate new tests with existing test infrastructure
  - **Tasks**:
    - Update `tests/spec-behavioral/run-all.sh`
    - Add new test file execution in correct order
    - Maintain existing test execution order
    - Add coverage tracking to test runner
    - Add coverage validation to test runner
    - Update test runner documentation
  - **Acceptance Criteria**:
    - run-all.sh executes all new tests
    - Tests execute in correct order (2.6, 4.7, 5.3, 5.7, 5.8, 5.9, 8.4, 8.8)
    - Existing tests continue to execute
    - Coverage tracking is integrated
    - Coverage validation is integrated
  - **Requirements**: Design section "Test Execution Flow"

---

## Phase 2: Section 2.6 - SessionStart Hook Field Model

- [ ] 2.1 Implement SessionStart hook field model tests
  - **Objective**: Validate that SessionStart hooks receive correct field model
  - **Tasks**:
    - Create `tests/spec-behavioral/section-2.6-sessionstart-hook.sh`
    - Implement test for required fields (hook_event_name, session_id, conversation_id, runtime_db_path, cwd, source)
    - Implement test for source='user_initiated'
    - Implement test for source='auto_recovery'
    - Implement test for source='test_execution'
    - Implement test for JSON schema compliance
    - Implement test for no extra fields beyond schema
    - Implement test for all required fields present
    - Document test cases and fixtures
  - **Acceptance Criteria**:
    - All 7 test cases from Requirement 1 are implemented
    - Tests use fixtures from lib/fixtures.sh
    - Tests use assertions from lib/assertions.sh
    - Tests target observable system state (hook stdin, logs, DB)
    - Tests do NOT mock/stub implementation
    - Tests exercise real code paths
    - All tests pass
  - **Requirements**: Requirement 1 (SessionStart Hook Field Model)

---

## Phase 3: Section 4.7 - Ranking/Import Rules for Memories

- [ ] 3.1 Implement memory ranking and import tests
  - **Objective**: Validate memory ranking and import rules
  - **Tasks**:
    - Create `tests/spec-behavioral/section-4.7-memory-ranking.sh`
    - Implement test for offline import into memories table
    - Implement test for ranking follows ARCHITECTURE.md rules
    - Implement test for authoritative reads do NOT come from shared-memory/.md
    - Implement test for higher-ranked memories prioritized
    - Implement test for import rule violation detection
    - Implement test for ranking correctly applied
    - Document test cases and fixtures
  - **Acceptance Criteria**:
    - All 6 test cases from Requirement 2 are implemented
    - Tests use fixtures from lib/fixtures.sh
    - Tests use assertions from lib/assertions.sh
    - Tests target observable system state (memories table, DB)
    - Tests do NOT mock/stub implementation
    - Tests exercise real code paths
    - All tests pass
  - **Requirements**: Requirement 2 (Ranking/Import Rules for Memories)

---

## Phase 4: Section 5.3 - Sequential Execution (Hook Ordering)

- [ ] 4.1 Implement hook ordering tests
  - **Objective**: Validate that hooks execute in correct sequential order
  - **Tasks**:
    - Create `tests/spec-behavioral/section-5.3-hook-ordering.sh`
    - Implement test for ascending hook_ordinal order
    - Implement test for duplicate ordinal deduplication
    - Implement test for exit code 0 continues to next hook
    - Implement test for exit code 2 (blocking) skips remaining
    - Implement test for other exit codes are non-blocking
    - Implement test for accumulated state passed to next hook
    - Implement test for ordering violation detection
    - Document test cases and fixtures
  - **Acceptance Criteria**:
    - All 7 test cases from Requirement 3 are implemented
    - Tests use fixtures from lib/fixtures.sh
    - Tests use assertions from lib/assertions.sh
    - Tests target observable system state (hook logs, execution order)
    - Tests do NOT mock/stub implementation
    - Tests exercise real code paths
    - All tests pass
  - **Requirements**: Requirement 3 (Sequential Execution - Hook Ordering)

---

## Phase 5: Section 5.7 - PreToolUse Permission Dialog Flow

- [ ] 5.1 Implement PreToolUse permission dialog tests
  - **Objective**: Validate PreToolUse permission dialog flow
  - **Tasks**:
    - Create `tests/spec-behavioral/section-5.7-permission-dialog.sh`
    - Implement test for exit code 2 captures permission decision
    - Implement test for deny decision blocks tool call
    - Implement test for ask decision prompts operator
    - Implement test for allow decision proceeds
    - Implement test for precedence: deny > ask > allow
    - Implement test for decision persisted to database
    - Implement test for invalid permission data handling
    - Document test cases and fixtures
  - **Acceptance Criteria**:
    - All 7 test cases from Requirement 4 are implemented
    - Tests use fixtures from lib/fixtures.sh
    - Tests use assertions from lib/assertions.sh
    - Tests target observable system state (tool_permission_log, DB, tool execution)
    - Tests do NOT mock/stub implementation
    - Tests exercise real code paths
    - All tests pass
  - **Requirements**: Requirement 4 (PreToolUse Permission Dialog Flow)

---

## Phase 6: Section 5.8 - Async Hooks (Forbidden Pattern)

- [ ] 6.1 Implement async hooks forbidden pattern tests
  - **Objective**: Validate that async hooks are forbidden
  - **Tasks**:
    - Create `tests/spec-behavioral/section-5.8-async-hooks.sh`
    - Implement test for `{"async":true}` rejection with error
    - Implement test for `{"async":false}` acceptance
    - Implement test for omitted async field defaults to false
    - Implement test for async execution is blocked
    - Implement test for error message indicates forbidden pattern
    - Implement test for validation happens before execution
    - Implement test for invalid config rejected before execution
    - Document test cases and fixtures
  - **Acceptance Criteria**:
    - All 7 test cases from Requirement 5 are implemented
    - Tests use fixtures from lib/fixtures.sh
    - Tests use assertions from lib/assertions.sh
    - Tests target observable system state (validation results, error messages)
    - Tests do NOT mock/stub implementation
    - Tests exercise real code paths
    - All tests pass
  - **Requirements**: Requirement 5 (Async Hooks - Forbidden Pattern)

---

## Phase 7: Section 5.9 - Hook Timeouts

- [ ] 7.1 Implement hook timeout tests
  - **Objective**: Validate hook timeout behavior
  - **Tasks**:
    - Create `tests/spec-behavioral/section-5.9-hook-timeouts.sh`
    - Implement test for hook exceeding timeout is terminated
    - Implement test for hook completing within timeout is captured
    - Implement test for timeout recorded in execution log
    - Implement test for error message includes [SDLC_INTERNAL] prefix
    - Implement test for timeout is non-blocking failure
    - Implement test for timeout value is respected
    - Implement test for system continues without hanging
    - Document test cases and fixtures
  - **Acceptance Criteria**:
    - All 7 test cases from Requirement 6 are implemented
    - Tests use fixtures from lib/fixtures.sh
    - Tests use assertions from lib/assertions.sh
    - Tests target observable system state (execution logs, process status)
    - Tests do NOT mock/stub implementation
    - Tests exercise real code paths
    - All tests pass
  - **Requirements**: Requirement 6 (Hook Timeouts)

---

## Phase 8: Section 8.4 - Operator Workflow Hooks

- [ ] 8.1 Implement operator workflow hooks tests
  - **Objective**: Validate operator workflow hooks
  - **Tasks**:
    - Create `tests/spec-behavioral/section-8.4-operator-hooks.sh`
    - Implement test for workflow hook registration
    - Implement test for hook receives correct event context
    - Implement test for hook result applied to workflow state
    - Implement test for multiple hooks execute in correct order
    - Implement test for hook failure handling (blocking vs non-blocking)
    - Implement test for state modifications persisted
    - Implement test for removed hooks no longer execute
    - Document test cases and fixtures
  - **Acceptance Criteria**:
    - All 7 test cases from Requirement 7 are implemented
    - Tests use fixtures from lib/fixtures.sh
    - Tests use assertions from lib/assertions.sh
    - Tests target observable system state (workflow state, DB, logs)
    - Tests do NOT mock/stub implementation
    - Tests exercise real code paths
    - All tests pass
  - **Requirements**: Requirement 7 (Operator Workflow Hooks)

---

## Phase 9: Section 8.8 - Behavioral Test Templates

- [ ] 9.1 Implement behavioral test template tests
  - **Objective**: Validate behavioral test templates
  - **Tasks**:
    - Create `tests/spec-behavioral/section-8.8-test-templates.sh`
    - Implement test for test follows one of 35 normative templates
    - Implement test for all required assertions included
    - Implement test for test targets observable system state
    - Implement test for test does NOT mock/stub implementation
    - Implement test for test exercises real code paths
    - Implement test for test traces to plan success criterion
    - Implement test for test is maintainable and follows pattern
    - Document test cases and fixtures
  - **Acceptance Criteria**:
    - All 7 test cases from Requirement 8 are implemented
    - Tests use fixtures from lib/fixtures.sh
    - Tests use assertions from lib/assertions.sh
    - Tests target observable system state (test structure, assertions)
    - Tests do NOT mock/stub implementation
    - Tests exercise real code paths
    - All tests pass
  - **Requirements**: Requirement 8 (Behavioral Test Templates)

---

## Phase 10: Verification and Integration

- [ ] 10.1 Verify coverage tracking accuracy
  - **Objective**: Ensure coverage tracking correctly identifies all tested requirements
  - **Tasks**:
    - Run coverage-tracker.sh to generate coverage matrix
    - Verify matrix includes all 99 normative requirements
    - Verify matrix correctly maps requirements to test files
    - Verify matrix shows pass/fail status for each test
    - Verify coverage percentage is calculated correctly
    - Document coverage matrix results
  - **Acceptance Criteria**:
    - Coverage matrix includes all 99 requirements
    - All requirements are mapped to test files
    - Coverage percentage is accurate
    - Matrix is in correct JSON format
  - **Requirements**: Design section "Coverage Tracking Architecture"

- [ ] 10.2 Verify 100% coverage achievement
  - **Objective**: Confirm all normative requirements have corresponding tests
  - **Tasks**:
    - Run validate-coverage.sh
    - Verify all 99 requirements have tests
    - Verify all tests pass
    - Verify coverage percentage is 100%
    - Verify no uncovered requirements reported
    - Document coverage verification results
  - **Acceptance Criteria**:
    - All 99 requirements have tests
    - All tests pass
    - Coverage is 100%
    - validate-coverage.sh exits with 0
  - **Requirements**: Design section "Coverage Tracking Architecture"

- [ ] 10.3 Verify preservation of existing tests
  - **Objective**: Ensure existing tests continue to pass without regression
  - **Tasks**:
    - Run all existing tests (sections 1, 2.4, 4.*, 8.1)
    - Verify all 42 existing tests pass
    - Verify test results are identical to baseline
    - Verify no regressions or side effects
    - Document preservation verification results
  - **Acceptance Criteria**:
    - All 42 existing tests pass
    - Test results match baseline
    - No regressions detected
    - No side effects on existing functionality
  - **Requirements**: Design section "Preservation of Existing Tests"

- [ ] 10.4 Verify test integration with CI/CD
  - **Objective**: Ensure tests integrate seamlessly with CI/CD pipeline
  - **Tasks**:
    - Verify run-all.sh executes all tests in correct order
    - Verify test output is compatible with CI/CD reporting
    - Verify tests can be executed in CI/CD environment
    - Verify coverage tracking integrates with CI/CD
    - Document CI/CD integration results
  - **Acceptance Criteria**:
    - run-all.sh executes all tests
    - Tests execute in correct order
    - Test output is CI/CD compatible
    - Coverage tracking works in CI/CD
  - **Requirements**: Design section "Integration with Existing Infrastructure"

- [ ] 10.5 Final verification and sign-off
  - **Objective**: Confirm feature is complete and ready for deployment
  - **Tasks**:
    - Run complete test suite: `tests/spec-behavioral/run-all.sh`
    - Verify all tests pass (42 existing + 49 new = 91 total)
    - Verify coverage is 100% (99/99 requirements)
    - Verify no regressions or side effects
    - Generate final coverage report
    - Document feature completion
  - **Acceptance Criteria**:
    - All 91 tests pass
    - Coverage is 100%
    - No regressions detected
    - Feature is ready for deployment
  - **Requirements**: All requirements (1.1-1.8, 3.1-3.4)

---

## Summary

**Total Tasks**: 10 phases with 15 concrete implementation tasks

**Test Files to Create**: 8 new test files
- section-2.6-sessionstart-hook.sh
- section-4.7-memory-ranking.sh
- section-5.3-hook-ordering.sh
- section-5.7-permission-dialog.sh
- section-5.8-async-hooks.sh
- section-5.9-hook-timeouts.sh
- section-8.4-operator-hooks.sh
- section-8.8-test-templates.sh

**Infrastructure Files to Create**: 4 new infrastructure files
- lib/fixtures.sh
- lib/assertions.sh
- coverage/coverage-tracker.sh
- coverage/validate-coverage.sh

**Files to Update**: 1 file
- run-all.sh

**Expected Outcomes**:
- 49 new behavioral tests (7 per section × 8 sections - 1 for section 4.7)
- 100% coverage of 99 normative requirements
- All 42 existing tests continue to pass
- Seamless integration with CI/CD pipeline
- Comprehensive test documentation
