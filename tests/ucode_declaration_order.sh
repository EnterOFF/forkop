#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"

node "$ROOT_DIR/tests/helpers/ucode_declaration_order.js" "$FORKOP_LIB" ||
  exit 1

printf 'ucode declaration order checks passed\n'
