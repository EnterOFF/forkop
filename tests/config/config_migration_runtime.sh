#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

MIGRATION="$FORKOP_LIB/config/migration.uc"
DEFAULT_CONFIG="$FORKOP_FILES/etc/config/forkop"

# Reset is a file replacement, not hundreds of inferred UCI edits: the original
# bytes are backed up and the installed canonical file wins atomically.
cat >"$WORK_DIR/old.state" <<'EOF_UCI'
forkop.settings=settings
forkop.settings.config_version=1.0.1
forkop.old=section
forkop.old.action=connection
EOF_UCI
cat >"$WORK_DIR/forkop.conf" <<'EOF_CONFIG'
config settings 'settings'
        option config_version '1.0.1'
config section 'old'
        option action 'connection'
EOF_CONFIG
: >"$WORK_DIR/uci.log"

FORKOP_UCI_STATE_FILE="$WORK_DIR/old.state" \
FORKOP_UCI_LOG_FILE="$WORK_DIR/uci.log" \
FORKOP_CONFIG_PATH="$WORK_DIR/forkop.conf" \
FORKOP_DEFAULT_CONFIG_PATH="$DEFAULT_CONFIG" \
FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD="$WORK_DIR/guard" \
FORKOP_LIB="$FORKOP_LIB" \
ucode -L "$FORKOP_LIB" "$MIGRATION" migrate

cmp -s "$DEFAULT_CONFIG" "$WORK_DIR/forkop.conf" ||
  fail "an unsupported old schema must be atomically replaced by canonical defaults"
grep -Fq "option config_version '1.0.1'" "$WORK_DIR/forkop.conf.migration-backup.1.0.1" ||
  fail "reset must retain the exact pre-migration configuration"
if grep -Fq 'commit forkop' "$WORK_DIR/uci.log"; then
  fail "a full reset must not mix a replacement file with staged UCI edits"
fi

# Released inline server credentials become an anonymous server_client through the
# real UCI adapter, including its owner reference and secret value.
cat >"$WORK_DIR/server.state" <<'EOF_UCI'
forkop.settings=settings
forkop.settings.config_version=1.0.5
forkop.settings.applied_migrations=interface_sections enable_component_checks http_connection_urls
forkop.inbound=server
forkop.inbound.label=VLESS
forkop.inbound.protocol=vless
forkop.inbound.server_uuid=44444444-4444-4444-8444-444444444444
EOF_UCI
cat >"$WORK_DIR/server.conf" <<'EOF_CONFIG'
config settings 'settings'
        option config_version '1.0.5'
EOF_CONFIG
: >"$WORK_DIR/server.log"

FORKOP_UCI_STATE_FILE="$WORK_DIR/server.state" \
FORKOP_UCI_LOG_FILE="$WORK_DIR/server.log" \
FORKOP_CONFIG_PATH="$WORK_DIR/server.conf" \
FORKOP_DEFAULT_CONFIG_PATH="$DEFAULT_CONFIG" \
FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD="$WORK_DIR/server.guard" \
FORKOP_LIB="$FORKOP_LIB" \
ucode -L "$FORKOP_LIB" "$MIGRATION" migrate

grep -Fxq 'forkop.settings.config_version=NEXT' "$WORK_DIR/server.state" ||
  fail "runtime migration must persist the dev schema version"
if grep -Fq 'forkop.settings.applied_migrations=' "$WORK_DIR/server.state"; then
  fail "runtime migration must remove the legacy marker list"
fi
client_id="$(sed -n 's/^forkop\.\(cfg[0-9a-f]*\)=server_client$/\1/p' "$WORK_DIR/server.state" | head -n 1)"
[ -n "$client_id" ] && grep -Fxq "forkop.$client_id.server=inbound" "$WORK_DIR/server.state" &&
  grep -Fxq "forkop.$client_id.uuid=44444444-4444-4444-8444-444444444444" "$WORK_DIR/server.state" ||
  fail "runtime migration must create the released server account with its owner and UUID"
grep -Fq 'config_version' "$WORK_DIR/server.conf.migration-backup.1.0.5" ||
  fail "a normal version migration must also retain a pre-migration backup"
grep -Fxq 'commit forkop' "$WORK_DIR/server.log" ||
  fail "normal migration must commit through core.uci"

# A real UCI parse failure is detected before core.uci can turn it into a null
# model or a stack trace, and the exact parser line/byte is kept in the error.
mkdir -p "$WORK_DIR/bin"
cat >"$WORK_DIR/bin/uci" <<'EOF_UCI_BIN'
#!/bin/sh
printf '%s\n' "uci: Parse error (invalid command) at line 7, byte 3" >&2
exit 1
EOF_UCI_BIN
chmod +x "$WORK_DIR/bin/uci"
if PATH="$WORK_DIR/bin:$PATH" \
  FORKOP_CONFIG_PATH="$WORK_DIR/malformed.conf" \
  FORKOP_LIB="$FORKOP_LIB" \
  ucode -L "$FORKOP_LIB" "$MIGRATION" migrate >"$WORK_DIR/malformed.out" 2>"$WORK_DIR/malformed.err"; then
  fail "malformed UCI must stop migration"
fi
grep -Fq 'line 7, byte 3' "$WORK_DIR/malformed.err" ||
  fail "UCI parser diagnostics must preserve the concrete line and byte"
grep -Fq "$WORK_DIR/malformed.conf" "$WORK_DIR/malformed.err" ||
  fail "UCI parser diagnostics must name the broken configuration path"

cat >"$WORK_DIR/bin/uci" <<'EOF_UCI_BIN'
#!/bin/sh
printf '%s\n' 'forkop.settings=settings'
printf '%s\n' "forkop.settings.config_version='1.0.5'"
printf '%s\n' 'forkop.@client[0]=server_client'
EOF_UCI_BIN
chmod +x "$WORK_DIR/bin/uci"
cat >"$WORK_DIR/unknown.state" <<'EOF_UCI'
forkop.settings=settings
forkop.settings.config_version=1.0.5
EOF_UCI
if PATH="$WORK_DIR/bin:$PATH" \
  FORKOP_UCI_STATE_FILE="$WORK_DIR/unknown.state" \
  FORKOP_UCI_LOG_FILE="$WORK_DIR/unknown.log" \
  FORKOP_RUN_UCI_PREFLIGHT=1 \
  FORKOP_CONFIG_PATH="$WORK_DIR/unknown.conf" \
  FORKOP_DEFAULT_CONFIG_PATH="$DEFAULT_CONFIG" \
  FORKOP_LIB="$FORKOP_LIB" \
  ucode -L "$FORKOP_LIB" "$MIGRATION" migrate >"$WORK_DIR/unknown.out" 2>"$WORK_DIR/unknown.err"; then
  fail "section types from an unpublished schema must stop a released migration"
fi
grep -Fq "UCI section '@client[0]' has unsupported type 'server_client'" "$WORK_DIR/unknown.err" ||
  fail "schema-mismatch diagnostics must name the section and type: $(cat "$WORK_DIR/unknown.err")"

# Unknown legacy sections do not matter when no config_version exists: the whole
# file is unsupported input and must be replaced rather than partially inspected.
cat >"$WORK_DIR/bin/uci" <<'EOF_UCI_BIN'
#!/bin/sh
printf '%s\n' 'forkop.settings=settings'
printf '%s\n' 'forkop.@mystery[0]=mystery'
EOF_UCI_BIN
chmod +x "$WORK_DIR/bin/uci"
cat >"$WORK_DIR/missing-version.state" <<'EOF_UCI'
forkop.settings=settings
EOF_UCI
cat >"$WORK_DIR/missing-version.conf" <<'EOF_CONFIG'
config settings 'settings'
config mystery
EOF_CONFIG
if ! PATH="$WORK_DIR/bin:$PATH" \
  FORKOP_UCI_STATE_FILE="$WORK_DIR/missing-version.state" \
  FORKOP_UCI_LOG_FILE="$WORK_DIR/missing-version.log" \
  FORKOP_RUN_UCI_PREFLIGHT=1 \
  FORKOP_CONFIG_PATH="$WORK_DIR/missing-version.conf" \
  FORKOP_DEFAULT_CONFIG_PATH="$DEFAULT_CONFIG" \
  FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD="$WORK_DIR/missing.guard" \
  FORKOP_LIB="$FORKOP_LIB" \
  ucode -L "$FORKOP_LIB" "$MIGRATION" migrate >"$WORK_DIR/missing.out" 2>"$WORK_DIR/missing.err"; then
  fail "a config without config_version must reset even when it contains obsolete section types"
fi
cmp -s "$DEFAULT_CONFIG" "$WORK_DIR/missing-version.conf" ||
  fail "a config without config_version must be replaced by the canonical defaults"
grep -Fq 'config mystery' "$WORK_DIR/missing-version.conf.migration-backup.missing" ||
  fail "reset must preserve the exact unsupported source in its backup"

printf 'runtime config migration checks passed\n'
