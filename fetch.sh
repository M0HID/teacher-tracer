#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "setup" ]]; then
  (
    cd "$ROOT_DIR"
    npm install
    npx playwright install chromium
  )
  exit 0
fi

node "$ROOT_DIR/src/cli.mjs" "$@"
