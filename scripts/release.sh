#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 1.0.1"
  exit 1
fi

VERSION="$1"

# Validate semver
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Error: Version must be semver (e.g. 1.0.1)"
  exit 1
fi

echo "=== Bumping version to $VERSION ==="

# Update package.json (macOS sed -i '' for in-place)
sed -i '' 's/"version": "[^"]*"/"version": "'"$VERSION"'"/' package.json

# Update wxt.config.ts
sed -i '' 's/version: "[^"]*"/version: "'"$VERSION"'"/' wxt.config.ts

echo "=== Building & zipping ==="
npm run zip

ZIP_FILE=$(ls -t dist/*.zip 2>/dev/null | head -1)
if [ -n "$ZIP_FILE" ]; then
  echo ""
  echo "=== Release $VERSION ready ==="
  echo "  Zip: $ZIP_FILE"
  echo ""
  echo "Next steps:"
  echo "  1. Upload $ZIP_FILE to Chrome Web Store Developer Dashboard"
  echo "  2. Update listing with new version notes"
  echo "  3. Submit for review"
else
  echo "Warning: No zip file found in dist/"
fi
