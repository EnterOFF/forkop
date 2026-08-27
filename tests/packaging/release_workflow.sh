#!/usr/bin/env bash
set -eo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

workflow="$ROOT_DIR/.github/workflows/build.yml"

if grep -Fiq 'sourceforge' "$workflow"; then
  fail 'Build workflow must leave SourceForge publication to GitHub Integration'
fi

grep -Fq 'uses: softprops/action-gh-release@v2.4.0' "$workflow" ||
  fail 'the release step must stay pinned to action-gh-release@v2.4.0'
grep -Fq 'files: ./filtered-bin/release/*.*' "$workflow" ||
  fail 'the release must publish everything build.sh left in filtered-bin/release'

printf 'release workflow checks passed\n'
