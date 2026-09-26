#!/usr/bin/env bash
# Runs the ucode unit tests: every tests/unit/**/*.test.uc in its own interpreter,
# with the fake uci/ubus/uloop modules ahead of any real ones on the search path.
#
#   tests/unit/run.sh              # everything
#   tests/unit/run.sh nft/         # tests whose path contains the filter
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_DIR="$ROOT_DIR/tests/unit"
FILTER="${1:-}"

command -v ucode >/dev/null 2>&1 || { printf 'ucode is not on PATH\n' >&2; exit 2; }

FORKOP_TEST_TMP="$(mktemp -d)"
export FORKOP_TEST_TMP
trap 'rm -rf "$FORKOP_TEST_TMP"' EXIT

failures=0
total=0
while IFS= read -r test_file; do
    relative="${test_file#"$UNIT_DIR"/}"
    if [ -n "$FILTER" ] && [[ "$relative" != *"$FILTER"* ]]; then
        continue
    fi
    total=$((total + 1))
    if ! output="$(cd "$UNIT_DIR" && ucode -L "$UNIT_DIR/fakes" -L "$UNIT_DIR/lib" -L "$ROOT_DIR/forkop/files/usr/lib" "$test_file" 2>&1)"; then
        failures=$((failures + 1))
        printf '=== FAIL %s\n%s\n' "$relative" "$output"
    fi
done < <(find "$UNIT_DIR" -name '*.test.uc' -type f | sort)

printf '%s of %s unit test files failed\n' "$failures" "$total"
[ "$failures" -eq 0 ]
