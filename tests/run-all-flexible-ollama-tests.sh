#!/bin/bash
# Run all tests for flexible-ollama-model-support spec

set -euo pipefail

echo "=========================================="
echo "Running All Flexible Ollama Model Support Tests"
echo "=========================================="
echo ""

FAILED=0

# Property tests
echo "=== Property Tests ==="
echo ""

if node tests/property/custom-model-name-precedence.mjs; then
  echo "✓ Custom model name precedence tests passed"
else
  echo "✗ Custom model name precedence tests failed"
  FAILED=1
fi
echo ""

if node tests/property/backward-compatibility.mjs; then
  echo "✓ Backward compatibility tests passed"
else
  echo "✗ Backward compatibility tests failed"
  FAILED=1
fi
echo ""

if node tests/property/flexible-providers-custom-models.mjs; then
  echo "✓ Flexible providers custom models tests passed"
else
  echo "✗ Flexible providers custom models tests failed"
  FAILED=1
fi
echo ""

if node tests/property/restricted-providers-reject-custom.mjs; then
  echo "✓ Restricted providers reject custom tests passed"
else
  echo "✗ Restricted providers reject custom tests failed"
  FAILED=1
fi
echo ""

if node tests/property/discovery-response-validation.mjs; then
  echo "✓ Discovery response validation tests passed"
else
  echo "✗ Discovery response validation tests failed"
  FAILED=1
fi
echo ""

# Unit tests
echo "=== Unit Tests ==="
echo ""

if node tests/unit/resolve-wire-model.mjs; then
  echo "✓ resolveWireModel unit tests passed"
else
  echo "✗ resolveWireModel unit tests failed"
  FAILED=1
fi
echo ""

if node tests/unit/resolve-model-arg.mjs; then
  echo "✓ resolveModelArg unit tests passed"
else
  echo "✗ resolveModelArg unit tests failed"
  FAILED=1
fi
echo ""

if node tests/unit/discover-ollama-models.mjs; then
  echo "✓ discoverOllamaModels unit tests passed"
else
  echo "✗ discoverOllamaModels unit tests failed"
  FAILED=1
fi
echo ""

if node tests/unit/format-model-list.mjs; then
  echo "✓ formatModelList unit tests passed"
else
  echo "✗ formatModelList unit tests failed"
  FAILED=1
fi
echo ""

# Summary
echo "=========================================="
if [ $FAILED -eq 0 ]; then
  echo "✓ All tests passed!"
  exit 0
else
  echo "✗ Some tests failed"
  exit 1
fi
