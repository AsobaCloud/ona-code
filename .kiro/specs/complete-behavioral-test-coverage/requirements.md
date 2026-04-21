# Complete Behavioral Test Coverage Requirements

## Introduction

The CLEAN_ROOM_SPEC.md defines 99 normative requirements across 25 sections. The current behavioral test suite covers only 88% of these requirements (42 passing tests covering 22 sections), leaving 8 critical sections untested. This feature implements comprehensive behavioral test coverage for all remaining uncovered sections to achieve 100% specification compliance validation.

The feature addresses the gap identified in the missing-behavioral-test-coverage bugfix by systematically implementing behavioral tests for:
- §2.6 SessionStart hook field model
- §4.7 Ranking/import rules for memories
- §5.3 Sequential execution (hook ordering)
- §5.7 PreToolUse permission dialog flow
- §5.8 Async hooks (forbidden pattern)
- §5.9 Hook timeouts
- §8.4 Operator workflow hooks
- §8.8 Behavioral test templates (35 normative statements)

## Glossary

- **Behavioral_Test**: A test that validates actual system behavior against specification requirements, not just smoke/happy path testing
- **Normative_Requirement**: A "must", "shall", "required", or "forbidden" statement in CLEAN_ROOM_SPEC.md that defines binding conformance behavior
- **Test_Coverage**: The percentage of normative requirements that have corresponding behavioral tests validating compliance
- **Uncovered_Section**: A specification section with normative requirements but no corresponding behavioral tests
- **Test_Fixture**: Reusable test data, database state, or configuration used across multiple behavioral tests
- **Epistemic_Isolation**: The principle that test generators must not access implementation source files to prevent tautological tests
- **Hook_Event**: One of 24 event types that trigger hook execution (PreToolUse, PostToolUse, SessionStart, etc.)
- **Permission_Rule**: A specification in Appendix E that controls tool access via allow/deny/ask patterns
- **Phase_Transition**: A state change in conversations.phase (idle → planning → implement → test → verify → done)
- **Test_Template**: A standardized pattern for behavioral tests that ensures consistency and maintainability

## Requirements

### Requirement 1: SessionStart Hook Field Model (§2.6)

**User Story:** As a test engineer, I want to validate that SessionStart hooks receive the correct field model, so that hook implementations can reliably access session context.

#### Acceptance Criteria

1. WHEN a SessionStart hook is triggered, THE Test Suite SHALL verify that the hook stdin includes all required fields: hook_event_name, session_id, conversation_id, runtime_db_path, cwd, source
2. WHEN a SessionStart hook is triggered with source='user_initiated', THE Test Suite SHALL verify the source field is correctly set
3. WHEN a SessionStart hook is triggered with source='auto_recovery', THE Test Suite SHALL verify the source field is correctly set
4. WHEN a SessionStart hook is triggered with source='test_execution', THE Test Suite SHALL verify the source field is correctly set
5. WHEN a SessionStart hook receives stdin, THE Test Suite SHALL verify the JSON is valid and matches the Appendix B schema
6. WHEN a SessionStart hook is triggered, THE Test Suite SHALL verify that no extra fields beyond the schema are included
7. WHEN a SessionStart hook is triggered, THE Test Suite SHALL verify that all required fields are present (no missing fields)

### Requirement 2: Ranking/Import Rules for Memories (§4.7)

**User Story:** As a test engineer, I want to validate memory ranking and import rules, so that memories are correctly prioritized and imported according to specification.

#### Acceptance Criteria

1. WHEN memories are imported from shared-memory/.md files, THE Test Suite SHALL verify that offline import into memories table is allowed
2. WHEN memories are ranked, THE Test Suite SHALL verify that ranking follows the operator ARCHITECTURE.md rules
3. WHEN memories are accessed at runtime, THE Test Suite SHALL verify that authoritative reads do NOT come from shared-memory/.md files
4. WHEN multiple memories exist with different ranks, THE Test Suite SHALL verify that higher-ranked memories are prioritized
5. WHEN a memory import rule is violated, THE Test Suite SHALL detect and report the violation
6. WHEN memories are imported, THE Test Suite SHALL verify that the import process respects the ranking rules
7. WHEN memory ranking is updated, THE Test Suite SHALL verify that the new ranking is correctly applied

### Requirement 3: Sequential Execution - Hook Ordering (§5.3)

**User Story:** As a test engineer, I want to validate that hooks execute in the correct sequential order, so that hook dependencies and side effects are properly managed.

#### Acceptance Criteria

1. WHEN multiple hooks are triggered for the same event, THE Test Suite SHALL verify that hooks execute in ascending hook_ordinal order
2. WHEN two hooks have the same hook_ordinal, THE Test Suite SHALL verify that the first hook is kept and subsequent duplicates are skipped
3. WHEN a hook completes with exit code 0, THE Test Suite SHALL verify that the next hook in sequence is executed
4. WHEN a hook completes with exit code 2 (blocking), THE Test Suite SHALL verify that remaining hooks in the sequence are skipped
5. WHEN a hook completes with exit code other than 0 or 2, THE Test Suite SHALL verify that the next hook in sequence is executed (non-blocking failure)
6. WHEN hooks are executed sequentially, THE Test Suite SHALL verify that each hook receives the correct stdin with accumulated state
7. WHEN hook ordering is violated, THE Test Suite SHALL detect and report the violation

### Requirement 4: PreToolUse Permission Dialog Flow (§5.7)

**User Story:** As a test engineer, I want to validate the PreToolUse permission dialog flow, so that permission decisions are correctly captured and applied.

#### Acceptance Criteria

1. WHEN a PreToolUse hook returns exit code 2 with permission decision, THE Test Suite SHALL verify that the decision is captured in tool_permission_log
2. WHEN a PreToolUse hook returns a deny decision, THE Test Suite SHALL verify that the tool call is blocked
3. WHEN a PreToolUse hook returns an ask decision, THE Test Suite SHALL verify that the operator is prompted for permission
4. WHEN a PreToolUse hook returns an allow decision, THE Test Suite SHALL verify that the tool call proceeds
5. WHEN multiple PreToolUse hooks return different decisions, THE Test Suite SHALL verify that deny takes precedence over ask, and ask takes precedence over allow
6. WHEN a permission decision is made, THE Test Suite SHALL verify that the decision is persisted to the database
7. WHEN a PreToolUse hook returns invalid permission data, THE Test Suite SHALL verify that the error is handled gracefully

### Requirement 5: Async Hooks (Forbidden Pattern) (§5.8)

**User Story:** As a test engineer, I want to validate that async hooks are forbidden, so that hook execution remains synchronous and predictable.

#### Acceptance Criteria

1. WHEN a hook configuration includes `{"async":true}`, THE Test Suite SHALL verify that the hook is rejected with a descriptive error
2. WHEN a hook configuration includes `{"async":false}`, THE Test Suite SHALL verify that the hook is accepted
3. WHEN a hook configuration omits the async field, THE Test Suite SHALL verify that the hook is accepted (defaults to false)
4. WHEN a hook attempts to execute asynchronously, THE Test Suite SHALL verify that the execution is blocked
5. WHEN an async hook is rejected, THE Test Suite SHALL verify that the error message clearly indicates the forbidden pattern
6. WHEN hook validation occurs, THE Test Suite SHALL verify that async validation happens before hook execution
7. WHEN a hook configuration is invalid, THE Test Suite SHALL verify that the hook is rejected before any execution

### Requirement 6: Hook Timeouts (§5.9)

**User Story:** As a test engineer, I want to validate hook timeout behavior, so that hung hooks don't block the system indefinitely.

#### Acceptance Criteria

1. WHEN a hook exceeds the timeout threshold, THE Test Suite SHALL verify that the hook process is terminated
2. WHEN a hook completes within the timeout, THE Test Suite SHALL verify that the hook result is captured normally
3. WHEN a hook times out, THE Test Suite SHALL verify that the timeout is recorded in the hook execution log
4. WHEN a hook times out, THE Test Suite SHALL verify that the error message includes [SDLC_INTERNAL] prefix
5. WHEN a hook timeout occurs, THE Test Suite SHALL verify that the next hook in sequence is executed (non-blocking failure)
6. WHEN a hook timeout is configured, THE Test Suite SHALL verify that the timeout value is respected
7. WHEN a hook timeout occurs, THE Test Suite SHALL verify that the system continues operation without hanging

### Requirement 7: Operator Workflow Hooks (§8.4)

**User Story:** As a test engineer, I want to validate operator workflow hooks, so that operators can extend the workflow with custom hooks.

#### Acceptance Criteria

1. WHEN an operator defines a workflow hook, THE Test Suite SHALL verify that the hook is registered correctly
2. WHEN a workflow hook is triggered, THE Test Suite SHALL verify that the hook receives the correct event context
3. WHEN a workflow hook returns a result, THE Test Suite SHALL verify that the result is applied to the workflow state
4. WHEN multiple workflow hooks are defined, THE Test Suite SHALL verify that they execute in the correct order
5. WHEN a workflow hook fails, THE Test Suite SHALL verify that the failure is handled according to the hook type (blocking vs non-blocking)
6. WHEN a workflow hook modifies state, THE Test Suite SHALL verify that the modifications are persisted correctly
7. WHEN a workflow hook is removed, THE Test Suite SHALL verify that it no longer executes

### Requirement 8: Behavioral Test Templates (§8.8)

**User Story:** As a test engineer, I want to validate behavioral test templates, so that tests are created consistently and comprehensively.

#### Acceptance Criteria

1. WHEN a behavioral test is created, THE Test Suite SHALL verify that the test follows one of the 35 normative test templates from §8.8
2. WHEN a test template is applied, THE Test Suite SHALL verify that all required assertions are included
3. WHEN a test template is applied, THE Test Suite SHALL verify that the test targets observable system state (DB, files, output, tools, hooks)
4. WHEN a test template is applied, THE Test Suite SHALL verify that the test does NOT mock or stub implementation modules
5. WHEN a test template is applied, THE Test Suite SHALL verify that the test exercises real code paths
6. WHEN a test is created, THE Test Suite SHALL verify that the test traces to a plan success criterion with [template: ...] tag
7. WHEN a test template is used, THE Test Suite SHALL verify that the test is maintainable and follows the template pattern

## Test Organization and Naming

### Test File Structure

Tests SHALL be organized by specification section:
- `tests/spec-behavioral/section-2.6-sessionstart-hook.sh` - SessionStart hook field model
- `tests/spec-behavioral/section-4.7-memory-ranking.sh` - Memory ranking/import rules
- `tests/spec-behavioral/section-5.3-hook-ordering.sh` - Sequential execution (hook ordering)
- `tests/spec-behavioral/section-5.7-permission-dialog.sh` - PreToolUse permission dialog flow
- `tests/spec-behavioral/section-5.8-async-hooks.sh` - Async hooks (forbidden pattern)
- `tests/spec-behavioral/section-5.9-hook-timeouts.sh` - Hook timeouts
- `tests/spec-behavioral/section-8.4-operator-hooks.sh` - Operator workflow hooks
- `tests/spec-behavioral/section-8.8-test-templates.sh` - Behavioral test templates

### Test Naming Convention

Each test SHALL follow the pattern: `test_<section>_<requirement_number>_<description>`

Example: `test_2_6_1_sessionstart_hook_includes_required_fields`

### Test Execution Order

Tests SHALL execute in specification section order:
1. Section 2.6 tests
2. Section 4.7 tests
3. Section 5.3 tests
4. Section 5.7 tests
5. Section 5.8 tests
6. Section 5.9 tests
7. Section 8.4 tests
8. Section 8.8 tests

## Test Data and Fixtures

### Fixture Requirements

1. WHEN tests require database state, THE Test Suite SHALL use a clean database fixture for each test
2. WHEN tests require hook configurations, THE Test Suite SHALL use standardized hook fixtures
3. WHEN tests require permission rules, THE Test Suite SHALL use standardized permission fixtures
4. WHEN tests require file system state, THE Test Suite SHALL use temporary directories with cleanup
5. WHEN tests require environment variables, THE Test Suite SHALL use isolated environment fixtures

### Fixture Management

- Fixtures SHALL be defined in `tests/spec-behavioral/lib/fixtures.sh`
- Fixtures SHALL be reusable across multiple tests
- Fixtures SHALL include setup and teardown functions
- Fixtures SHALL be documented with clear usage examples

## Test Integration

### Integration with Existing Test Runner

1. WHEN the test runner `tests/spec-behavioral/run-all.sh` executes, THE Test Suite SHALL include all new tests
2. WHEN tests execute, THE Test Suite SHALL maintain the correct execution order
3. WHEN tests complete, THE Test Suite SHALL generate a coverage report showing all tested requirements
4. WHEN tests fail, THE Test Suite SHALL provide clear error messages indicating which requirement failed

### Coverage Tracking

1. WHEN tests execute, THE Test Suite SHALL track which normative requirements are covered
2. WHEN coverage is calculated, THE Test Suite SHALL report the percentage of requirements with passing tests
3. WHEN coverage is incomplete, THE Test Suite SHALL identify which requirements lack tests
4. WHEN coverage reaches 100%, THE Test Suite SHALL confirm that all normative requirements are tested

## Coverage Metrics

### Metrics to Track

1. **Total Requirements**: 99 normative requirements in CLEAN_ROOM_SPEC.md
2. **Covered Requirements**: Number of requirements with passing behavioral tests
3. **Coverage Percentage**: (Covered Requirements / Total Requirements) × 100
4. **Tests per Requirement**: Average number of tests per requirement
5. **Test Pass Rate**: Percentage of tests that pass
6. **Uncovered Sections**: Sections with normative requirements but no tests

### Success Criteria

1. WHEN all tests execute, THE Test Suite SHALL achieve 100% coverage of normative requirements
2. WHEN coverage is calculated, THE Test Suite SHALL show 99 covered requirements (100%)
3. WHEN tests execute, THE Test Suite SHALL have 0 failing tests
4. WHEN coverage is reported, THE Test Suite SHALL identify 0 uncovered sections

## Test Suite Maintenance

### Maintenance Process

1. WHEN new normative requirements are added to CLEAN_ROOM_SPEC.md, THE Test Suite SHALL include a process to identify and create corresponding behavioral tests
2. WHEN specification requirements change, THE Test Suite SHALL update corresponding tests
3. WHEN tests fail, THE Test Suite SHALL provide clear guidance on whether the failure indicates a specification violation or a test issue
4. WHEN the test suite is updated, THE Test Suite SHALL maintain backward compatibility with existing tests

### Documentation

1. WHEN tests are created, THE Test Suite SHALL include clear documentation of what each test validates
2. WHEN tests are complex, THE Test Suite SHALL include comments explaining the test logic
3. WHEN tests use fixtures, THE Test Suite SHALL document the fixture setup and teardown
4. WHEN tests fail, THE Test Suite SHALL provide clear error messages indicating the root cause

### Continuous Integration

1. WHEN tests are committed, THE Test Suite SHALL execute in CI/CD pipeline
2. WHEN tests fail in CI, THE Test Suite SHALL block deployment until failures are resolved
3. WHEN coverage drops, THE Test Suite SHALL alert the team
4. WHEN all tests pass, THE Test Suite SHALL confirm specification compliance

## Success Criteria

### Feature Completion

1. WHEN the feature is complete, THE Test Suite SHALL have behavioral tests for all 8 uncovered sections
2. WHEN the feature is complete, THE Test Suite SHALL achieve 100% coverage of normative requirements (99/99)
3. WHEN the feature is complete, THE Test Suite SHALL have 0 failing tests
4. WHEN the feature is complete, THE Test Suite SHALL integrate seamlessly with existing test infrastructure

### Quality Standards

1. WHEN tests are created, THE Test Suite SHALL follow the behavioral test template patterns from §8.8
2. WHEN tests are created, THE Test Suite SHALL target observable system state (DB, files, output, tools, hooks)
3. WHEN tests are created, THE Test Suite SHALL NOT mock or stub implementation modules
4. WHEN tests are created, THE Test Suite SHALL exercise real code paths

### Verification

1. WHEN the feature is complete, THE Test Suite SHALL pass all 42 existing tests (preservation)
2. WHEN the feature is complete, THE Test Suite SHALL pass all new tests for the 8 uncovered sections
3. WHEN the feature is complete, THE Test Suite SHALL generate a coverage report showing 100% coverage
4. WHEN the feature is complete, THE Test Suite SHALL be ready for production deployment
