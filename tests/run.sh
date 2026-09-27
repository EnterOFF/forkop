#!/usr/bin/env bash
# The backend tests: every tests/**/*.test.uc, each in an interpreter of its
# own, started from this directory with
#
#     ucode -L fakes -L lib -L ../forkop/files/usr/lib <file>
#
# so a test requires the module it tests by its library name, and fakes/ stands
# in for ucode's uci, ubus and uloop modules on any ucode build, including CI's,
# which has none of them.
#
#     tests/run.sh             everything
#     tests/run.sh nft/        the files whose path contains the filter
#
# One directory per subject of forkop/files/usr/lib - config, core, service,
# singbox and so on - and beside them:
#
#     packaging/  the package definitions, read as files
#     page/       the tables the LuCI page carries a copy of
#     sources/    rules the interpreter cannot enforce, read off the sources
#     fixtures/   data the tests read, some of it shared with the page's tests
#     fakes/      uci, ubus and uloop; __seed(), __sections(), __commits() and
#                 __reset() set up and read back the fake uci
#     lib/        what a test requires:
#                   t           test(), eq(), ok(), contains(), throws(), done()
#                   stub        commands(), env(), clock(), capture(), fresh(), tmpdir()
#                   fixture     seed the fake uci from a configuration object
#                   validation  run the config validator over one
#                   sbconfig    look things up in a generated sing-box configuration
#                   program     run a module as a program, in its own interpreter
#                   repo        paths into the repository
#
# A test file registers its tests and ends with t.done(), which exits with the
# number that failed:
#
#     let t = require("t");
#     let stub = require("stub");
#
#     t.test("what it protects", () => {
#         stub.commands([ [ "nft list tables", { stdout: "" } ] ]);
#         // require the module, call it, assert on what it returned and ran
#         stub.restore();
#     });
#
#     t.done();
#
# stub.commands() answers system() and fs.popen() for the test, and a command
# no handler claims fails it instead of running on the machine. The page's own
# tests are vitest, under fe-app-forkop.
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
