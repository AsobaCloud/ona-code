#!/bin/bash
# Run all unit tests

set -euo pipefail

echo "Running Unit Tests..."
echo "===================="
echo ""

# Run bootstrap settings edge cases tests
echo "Running: bootstrap-settings-edge-cases.mjs"
node tests/unit/bootstrap-settings-edge-cases.mjs

echo ""
echo "===================="
echo "✓ All unit tests passed!"
