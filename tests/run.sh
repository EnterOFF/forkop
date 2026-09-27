#!/usr/bin/env bash
# Runs every tests/**/*.test.uc in an interpreter of its own, with fakes/ and
# lib/ ahead of forkop/files/usr/lib on the search path.
#
#     tests/run.sh          everything
#     tests/run.sh nft/     the files whose path contains the filter
set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILTER="${1:-}"

command -v ucode >/dev/null 2>&1 || { printf 'ucode is not on PATH\n' >&2; exit 2; }

FORKOP_TEST_TMP="$(mktemp -d)"
export FORKOP_TEST_TMP
trap 'rm -rf "$FORKOP_TEST_TMP"' EXIT

cd "$TESTS_DIR" || exit 2

failures=0
total=0
while IFS= read -r test_file; do
    test_file="${test_file#./}"
    if [ -n "$FILTER" ] && [[ "$test_file" != *"$FILTER"* ]]; then
        continue
    fi
    total=$((total + 1))
    if ! output="$(ucode -L fakes -L lib -L ../forkop/files/usr/lib "$test_file" 2>&1)"; then
        failures=$((failures + 1))
        printf '=== FAIL %s\n%s\n' "$test_file" "$output"
    fi
done < <(find . -name '*.test.uc' -type f | sort)

printf '%s of %s test files failed\n' "$failures" "$total"
[ "$failures" -eq 0 ]
