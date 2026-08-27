#!/usr/bin/env bash
# ucode has no hoisting: a function that calls a name declared below it in the
# same file is valid text and crashes at call time with "left-hand side is not a
# function" - on the router, in whichever branch happens to reach it first.
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

node "$TESTS_DIR/lib/ucode_declaration_order.js" "$FORKOP_LIB" ||
  fail 'a ucode module calls a function declared below it'

printf 'ucode declaration order checks passed\n'
