#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/main.js"
MAIN_TS="$ROOT_DIR/fe-app-forkop/src/main.ts"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

grep -Fq "import './helpers/structuredClonePolyfill';" "$MAIN_TS" ||
  fail "main.ts must load the structuredClone polyfill as its first import"
if grep -n 'globalThis.structuredClone' "$MAIN_TS" >/dev/null 2>&1; then
  fail "the structuredClone polyfill must live in its own module, not after the imports"
fi

polyfill_line="$(grep -n 'globalThis.structuredClone' "$MAIN_JS" | head -n 1 | cut -d: -f1)"
store_line="$(grep -n 'new StoreService(' "$MAIN_JS" | head -n 1 | cut -d: -f1)"
[ -n "$polyfill_line" ] ||
  fail "the built bundle must contain the structuredClone polyfill"
[ -n "$store_line" ] ||
  fail "the built bundle must create the store service"
[ "$polyfill_line" -lt "$store_line" ] ||
  fail "the structuredClone polyfill must run before the store service is created"

printf 'LuCI main bundle checks passed\n'
