# Unit Tests

This directory contains unit tests for individual functions and modules in the ona codebase.

## Test Files

### bootstrap-settings-edge-cases.mjs

Comprehensive unit tests for the `bootstrapSettings()` function in `lib/settings.mjs`.

**Requirements Validated:** 4.3, 5.4, 5.5, 6.1, 6.2, 6.3, 19.1, 19.2, 19.3

**Test Coverage:**

1. **First run scenarios:**
   - No database, no files (uses defaults)
   - Settings file present (merges file > defaults)

2. **Timestamp precedence:**
   - Existing database, no files (preserves database)
   - Database older than file (merges file > database > defaults)
   - Database newer than file (preserves database, ignores file)

3. **Multiple files:**
   - Merges all settings files (.ona/settings.json, .claude/settings.local.json, settings.json)

4. **Error handling:**
   - Corrupted settings file (skips file, uses database/defaults)
   - Corrupted database JSON (reinitializes from file/defaults)

5. **Source tracking:**
   - bootstrap-first-run
   - bootstrap-file-newer
   - bootstrap-db-preserved

6. **Edge cases:**
   - Empty settings file
   - Partial settings in file
   - Deep merge of nested objects
   - File with null values

## Running Tests

Run all unit tests:
```bash
npm run test:unit
```

Or run directly:
```bash
bash tests/unit/run-all.sh
```

Run a specific test file:
```bash
node tests/unit/bootstrap-settings-edge-cases.mjs
```

## Test Structure

Unit tests follow this structure:

1. **Test utilities:** Helper functions for creating test databases, directories, and files
2. **Test cases:** Individual test functions using a simple test runner
3. **Assertions:** Custom assertion functions for equality and deep equality checks
4. **Summary:** Test results summary with pass/fail counts

## Adding New Tests

To add new unit tests:

1. Create a new `.mjs` file in this directory
2. Follow the existing test structure (see bootstrap-settings-edge-cases.mjs as example)
3. Add the test to `run-all.sh`
4. Document the test in this README

## Dependencies

- `better-sqlite3`: For in-memory database testing
- `node:fs`, `node:path`, `node:os`: For file system operations
