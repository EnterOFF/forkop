#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

MATRIX_SCRIPT="$TESTS_DIR/lib/config_contract_matrix.js"
AUDIT_SCRIPT="$TESTS_DIR/lib/config_migration_audit.js"
DECISIONS="$TESTS_DIR/config/config_migration_decisions.json"
args=()

for version in 1.0.2 1.0.3 1.0.4 1.0.5; do
  stable="$WORK_DIR/stable-$version"
  mkdir -p "$stable"
  git -C "$ROOT_DIR" archive "$version" | tar -x -C "$stable" ||
    fail "failed to materialize Forkop $version"
  expected_schema="1.0.2"
  [ "$version" = "1.0.5" ] && expected_schema="1.0.5"
  grep -Fq "option config_version '$expected_schema'" "$stable/forkop/files/etc/config/forkop" ||
    fail "Forkop $version must be audited under its shipped config_version $expected_schema"
  matrix="$WORK_DIR/matrix-$version.json"
  node "$MATRIX_SCRIPT" --current "$ROOT_DIR" --stable "$stable" >"$matrix"
  args+=("$version=$matrix")
done

CONFIG_HISTORY_REPO="$ROOT_DIR" node "$AUDIT_SCRIPT" "$DECISIONS" "${args[@]}" >"$WORK_DIR/config-migration-audit.json"

node - "$WORK_DIR/config-migration-audit.json" <<'NODE'
const fs = require('fs');
const audit = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (audit.source_versions.join(',') !== '1.0.2,1.0.3,1.0.4,1.0.5') {
  throw new Error('migration audit must cover every supported historical release');
}
if (audit.fields.length < 200) {
  throw new Error(`migration audit unexpectedly covers only ${audit.fields.length} fields`);
}
if (audit.default_history.length < 100 || audit.section_history.length < 5 || audit.source_history.length < 150) {
  throw new Error('migration audit must retain the canonical config history between 1.0.2 and HEAD');
}
if (audit.dev_fields) {
  throw new Error('unpublished schemas must not be represented as supported dev migrations');
}
if (!audit.non_release_fields.tunnel_jsons || audit.non_release_fields.tunnel_jsons.action !== 'ignore') {
  throw new Error('tunnel_jsons must be recorded as an ignored non-release field');
}
for (const [name, decision] of Object.entries(audit.non_release_fields)) {
  if (decision.action !== 'ignore' || decision.target) {
    throw new Error(`non-release field ${name} must not define a migration`);
  }
}
for (const [field, values] of Object.entries(audit.non_release_values)) {
  for (const [value, decision] of Object.entries(values)) {
    if (decision.action !== 'ignore' || decision.target) {
      throw new Error(`non-release value ${field}=${value} must not define a migration`);
    }
  }
}
NODE

printf 'config migration history checks passed\n'
