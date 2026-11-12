#!/usr/bin/env bash
# Rebuild docs/Map-Compressor-User-Guide.pdf from manual.html with headless Chrome.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PROFILE="$(mktemp -d)"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --user-data-dir="$PROFILE" \
  --print-to-pdf="$PWD/../Map-Compressor-User-Guide.pdf" "file://$PWD/manual.html" 2>/dev/null
rm -rf "$PROFILE"
echo "Wrote docs/Map-Compressor-User-Guide.pdf"
