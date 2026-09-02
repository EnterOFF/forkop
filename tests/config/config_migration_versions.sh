#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

MIGRATION="$FORKOP_LIB/config/migration.uc"
DEFAULT_CONFIG="$FORKOP_FILES/etc/config/forkop"
export FORKOP_DEFAULT_CONFIG_PATH="$DEFAULT_CONFIG"

grep -Fq "option config_version 'NEXT'" "$DEFAULT_CONFIG" ||
  fail "new installations must use the explicit unreleased NEXT schema"
if grep -Fq 'applied_migrations' "$DEFAULT_CONFIG"; then
  fail "new installations must not persist migration implementation details"
fi
grep -Fq "option unmatched_dns_mode 'forkop'" "$DEFAULT_CONFIG" ||
  fail "new installations must resolve unmatched DNS through Forkop"
grep -Fq "option unified_delay '1'" "$DEFAULT_CONFIG" ||
  fail "new installations must enable Unified Delay"
if grep -Eq 'option dns_(main|bootstrap)_fallback_strategy' "$DEFAULT_CONFIG"; then
  fail "single-server defaults must not persist an irrelevant DNS fallback strategy"
fi
if grep -Fq 'list_option(settings, APPLIED_MIGRATIONS_OPTION)' "$MIGRATION"; then
  fail "versioned migration must never interpret the legacy marker list"
fi
while IFS= read -r option; do
  if grep -R -Fq "\"$option\"" "$FORKOP_LIB/config/migration.uc" "$FORKOP_LIB/config/migrations"; then
    fail "release migration contains non-release option $option"
  fi
done < <(node -e 'const d=require(process.argv[1]); console.log(Object.keys(d.non_release_fields).join("\n"))' \
  "$TESTS_DIR/config/config_migration_decisions.json")
while IFS= read -r value; do
  if grep -R -Fq "\"$value\"" "$FORKOP_LIB/config/migration.uc" "$FORKOP_LIB/config/migrations"; then
    fail "release migration contains non-release schema value $value"
  fi
done < <(node -e 'const d=require(process.argv[1]); for (const values of Object.values(d.non_release_values)) console.log(Object.keys(values).join("\n"))' \
  "$TESTS_DIR/config/config_migration_decisions.json")

cat >"$WORK_DIR/1.0.2.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_version": "1.0.2",
    "applied_migrations": ["do-not-trust-this-marker"],
    "dns_check_interval": "10s",
    "dns_recovery_check_interval": "60s",
    "dns_check_timeout": "2s"
  },
  "section": [
    {
      ".name": "main",
      ".type": "section",
      "label": "Main",
      "action": "connection",
      "selector_proxy_links": [
        "https://alice:secret@proxy.example.com:8443#Released HTTP",
        "vless://00000000-0000-4000-8000-000000000001@example.com:443#VLESS"
      ],
      "dashboard_filter_mode": "include",
      "dashboard_include_outbounds": ["Node"]
    }
  ],
  "priority_group": [
    {
      ".name": "legacy_group",
      ".type": "priority_group",
      "section": "main",
      "name": "Fallback",
      "health_url": "https://example.com/ping",
      "active_check_interval": "30s"
    }
  ],
  "priority_level": [
    {
      ".name": "legacy_level",
      ".type": "priority_level",
      "group": "legacy_group",
      "name": "Primary",
      "order": "0"
    }
  ]
}
JSON

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/1.0.2.json" >"$WORK_DIR/1.0.2.out.json"

node - "$WORK_DIR/1.0.2.out.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const config = out.config;
const assert = (value, message) => { if (!value) throw new Error(message); };
const absent = (object, key) => !Object.prototype.hasOwnProperty.call(object, key);

assert(out.changed, '1.0.2 must migrate');
assert(config.settings.config_version === 'NEXT', '1.0.2 must reach the dev schema');
assert(absent(config.settings, 'applied_migrations'), 'legacy markers must leave settings');
assert(absent(config.settings, 'dns_check_interval') &&
  absent(config.settings, 'dns_recovery_check_interval') &&
  absent(config.settings, 'dns_check_timeout'), 'retired DNS health settings must leave');
assert(absent(config.section[0], 'dashboard_filter_mode') &&
  absent(config.section[0], 'dashboard_include_outbounds'),
  'retired dashboard filter settings must leave');
assert(config.section[0].selector_proxy_links.length === 1 &&
  config.section[0].selector_proxy_links[0].startsWith('vless://'),
  'the 1.0.2 to 1.0.5 step must retain non-HTTP share links');
const http = JSON.parse(config.section[0].outbound_jsons[0]);
assert(http.type === 'http' && http.tag === 'Released HTTP' &&
  http.server === 'proxy.example.com' && http.server_port === 8443 &&
  http.username === 'alice' && http.password === 'secret' && http.tls?.enabled === true,
  'the released 1.0.2 HTTP link must cross the 1.0.5 schema boundary before NEXT');
assert((config.fallback_group || [])[0]?.['.type'] === 'fallback_group',
  'priority groups must become fallback groups');
assert((config.fallback_level || [])[0]?.['.type'] === 'fallback_level',
  'priority levels must become fallback levels');
NODE

cat >"$WORK_DIR/current.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_version": "NEXT",
    "applied_migrations": ["obsolete-marker"]
  },
  "section": []
}
JSON

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/current.json" >"$WORK_DIR/current.out.json"
node - "$WORK_DIR/current.out.json" "$WORK_DIR/current.once.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!out.changed || Object.prototype.hasOwnProperty.call(out.config.settings, 'applied_migrations')) {
  throw new Error('current schema must remove a stray legacy marker list once');
}
fs.writeFileSync(process.argv[3], JSON.stringify(out.config));
NODE

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/current.once.json" >"$WORK_DIR/current.twice.json"
node - "$WORK_DIR/current.twice.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (out.changed) throw new Error('current schema migration must be idempotent');
NODE

# NEXT is only the target placeholder of this checkout. Once the canonical target
# becomes a real release, an unpublished NEXT source is deliberately unsupported.
cat >"$WORK_DIR/1.0.5.json" <<'JSON'
{"settings":{".name":"settings",".type":"settings","config_version":"1.0.5"},"section":[]}
JSON
cat >"$WORK_DIR/release-default" <<'EOF_RELEASE'
config settings 'settings'
        option config_version '2.0.0'
EOF_RELEASE
FORKOP_DEFAULT_CONFIG_PATH="$WORK_DIR/release-default" \
  FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/1.0.5.json" >"$WORK_DIR/released-1.0.5.json"
node - "$WORK_DIR/released-1.0.5.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!out.changed || out.config.settings.config_version !== '2.0.0') {
  throw new Error('a released source must take the canonical release version without a hardcoded future version');
}
NODE
if FORKOP_DEFAULT_CONFIG_PATH="$WORK_DIR/release-default" \
  FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/current.once.json" >"$WORK_DIR/released.out" 2>"$WORK_DIR/released.err"; then
  fail "an unpublished NEXT source must not enter the public release migration graph"
fi
grep -Fq "option 'config_version' has invalid value 'NEXT'" "$WORK_DIR/released.err" ||
  fail "the rejected NEXT source must name the config_version problem"

cat >"$WORK_DIR/non-schema-release.json" <<'JSON'
{"settings":{".name":"settings",".type":"settings","config_version":"1.0.4"},"section":[]}
JSON
if FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/non-schema-release.json" >"$WORK_DIR/non-schema-release.out" 2>"$WORK_DIR/non-schema-release.err"; then
  fail "a package version that was never a config schema must not select an invented migration edge"
fi
grep -Fq "unknown released schema '1.0.4'; supported source schemas are 1.0.2 and 1.0.5" \
  "$WORK_DIR/non-schema-release.err" ||
  fail "unknown released schema diagnostics must list the real config_version values"

cat >"$WORK_DIR/old.json" <<'JSON'
{
  "settings": {".name": "settings", ".type": "settings", "config_version": "1.0.1"},
  "section": [
    {".name": "old", ".type": "section", "label": "Old", "action": "connection"}
  ]
}
JSON

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/old.json" >"$WORK_DIR/old.out.json"
node - "$WORK_DIR/old.out.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!out.reset || out.target_version !== 'NEXT' || out.config !== null) {
  throw new Error('schemas older than 1.0.2 must be recreated from defaults');
}
NODE

cat >"$WORK_DIR/missing-version.json" <<'JSON'
{"settings":{".name":"settings",".type":"settings"},"section":[]}
JSON
FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/missing-version.json" >"$WORK_DIR/missing-version.out.json"
node - "$WORK_DIR/missing-version.out.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!out.reset) throw new Error('a config without config_version predates the supported schema and must be recreated');
NODE

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/1.0.5.json" podkop >"$WORK_DIR/podkop.out.json"
node - "$WORK_DIR/podkop.out.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!out.reset) throw new Error('the legacy Podkop source must be recreated instead of entering Forkop version steps');
NODE

cat >"$WORK_DIR/invalid.json" <<'JSON'
{"settings":{".name":"settings",".type":"settings","config_version":"broken"}}
JSON
if FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/invalid.json" >"$WORK_DIR/invalid.out" 2>"$WORK_DIR/invalid.err"; then
  fail "an invalid config_version must be refused"
fi
grep -Fq "section 'settings', option 'config_version'" "$WORK_DIR/invalid.err" ||
  fail "invalid version diagnostics must name the section and option"

cat >"$WORK_DIR/future.json" <<'JSON'
{"settings":{".name":"settings",".type":"settings","config_version":"9.0.0"}}
JSON
if FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/future.json" >"$WORK_DIR/future.out" 2>"$WORK_DIR/future.err"; then
  fail "a newer config schema must be refused instead of downgraded"
fi
grep -Fq "newer than the newest migratable schema 1.0.5" "$WORK_DIR/future.err" ||
  fail "future schema diagnostics must explain the downgrade refusal"

printf 'versioned config migration checks passed\n'
