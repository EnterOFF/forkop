# shellcheck shell=bash
# The paths below are read by whichever test sourced this, so shellcheck cannot
# see their use when it is pointed at this file alone.
# shellcheck disable=SC2034
#
# What every test in this suite starts from, sourced as its second line:
#
#     #!/usr/bin/env bash
#     set -eo pipefail
#     . "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
#
# `set -eo pipefail` stays in the test rather than moving here, so a source that
# fails aborts instead of running the rest of the file with every check disabled.
#
# What it defines:
#
#   ROOT_DIR      the repository
#   FORKOP_FILES  forkop/files, the tree the package installs
#   FORKOP_BIN    the forkop CLI entry point
#   FORKOP_LIB    the ucode library the CLI and the service run out of
#   TESTS_DIR     this directory's parent, for a fixture or a node helper
#   WORK_DIR      a scratch directory, removed when the test exits
#   fail <text>   print FAIL: <text> on stderr and exit 1
#   generate_config <fixture> <output> [address] [mwan3]
#                 the generated sing-box configuration of a fixture
#
# The paths are derived from this file's own location, so a test does not care
# how deep in tests/ it sits.

FORKOP_TESTS_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_DIR="$(dirname "$FORKOP_TESTS_LIB")"
ROOT_DIR="$(dirname "$TESTS_DIR")"
FORKOP_FILES="$ROOT_DIR/forkop/files"
FORKOP_BIN="$FORKOP_FILES/usr/bin/forkop"
FORKOP_LIB="$FORKOP_FILES/usr/lib"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

# generate_config <fixture.json> <output.json> [service_address] [mwan3_active]
# Writes what the generator builds for a fixture, for a check against a real core.
generate_config() {
  ucode -L "$TESTS_DIR/unit/fakes" -L "$TESTS_DIR/unit/lib" -L "$FORKOP_LIB" \
    "$TESTS_DIR/lib/generate_config.uc" "$1" "${3:-127.0.0.1}" "${4:-0}" >"$2"
}

# Every test gets one, whether or not it writes anything into it: one mktemp is
# cheaper than a reader wondering which tests clean up after themselves. A test
# that needs more than a directory removed installs its own EXIT trap and takes
# WORK_DIR with it.
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
