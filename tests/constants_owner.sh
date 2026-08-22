#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_BIN="$ROOT_DIR/forkop/files/usr/bin/forkop"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
CLI_UC="$FORKOP_BIN"
FORKOP_MAKEFILE="$ROOT_DIR/forkop/Makefile"
BUILD_SCRIPT="$ROOT_DIR/build.sh"
CONSTANTS_SH="$FORKOP_LIB/constants.sh"
LIFECYCLE_UC="$FORKOP_LIB/service/lifecycle.uc"
CONSTANTS_UC="$FORKOP_LIB/core/constants.uc"
SINGBOX_CONSTANTS_UC="$FORKOP_LIB/singbox/constants.uc"
FRONTEND_CONSTANTS="$ROOT_DIR/fe-app-forkop/src/constants.ts"
SERVER_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/server.js"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

[ ! -e "$CONSTANTS_SH" ] ||
  fail "constants.sh shell owner must be removed"

grep -Fq '#!/usr/bin/ucode' "$FORKOP_BIN" ||
  fail "forkop entrypoint must be a direct ucode executable"
grep -Fq 'service/lifecycle.uc' "$CLI_UC" ||
  fail "service/cli.uc must dispatch lifecycle orchestration through service/lifecycle.uc"
grep -Fq 'core.constants' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc must load constants from core/constants.uc"

if grep -R -n -E 'constants\.sh|read_shell_constants|expand_shell_constants|unquote_shell_value' \
  "$FORKOP_BIN" "$FORKOP_LIB" --include='*.sh' --include='*.uc' >/dev/null 2>&1; then
  fail "shell constants owner or parser references must not remain"
fi

if grep -n 'constants\.sh' "$FORKOP_MAKEFILE" "$BUILD_SCRIPT" >/dev/null 2>&1; then
  fail "package build must not patch removed constants.sh"
fi
grep -Fq 'core/constants.uc' "$FORKOP_MAKEFILE" ||
  fail "forkop/Makefile must patch core/constants.uc"
grep -Fq 'core/constants.uc' "$BUILD_SCRIPT" ||
  fail "release build must patch core/constants.uc"

config_name="$(ucode -L "$FORKOP_LIB" "$CONSTANTS_UC" get FORKOP_CONFIG_NAME)"
[ "$config_name" = "forkop" ] ||
  fail "core/constants.uc get returned unexpected FORKOP_CONFIG_NAME"

eval "$(ucode -L "$FORKOP_LIB" "$CONSTANTS_UC" shell-env)"
[ "$FORKOP_CONFIG" = "/etc/config/forkop" ] ||
  fail "core/constants.uc shell-env did not derive FORKOP_CONFIG"
[ "$BYEDPI_PID_DIR" = "/var/run/forkop/byedpi/pid" ] ||
  fail "core/constants.uc shell-env did not derive BYEDPI_PID_DIR"

[ "$(ucode -L "$FORKOP_LIB" "$CONSTANTS_UC" get FAKEIP_TEST_DOMAIN)" = "fakeip.podkop.fyi" ] ||
  fail "FakeIP diagnostics must use the deployed public endpoint"
[ "$(ucode -L "$FORKOP_LIB" "$CONSTANTS_UC" get CHECK_PROXY_IP_DOMAIN)" = "ip.podkop.fyi" ] ||
  fail "public IP diagnostics must use the deployed public endpoint"
grep -Fq 'const FAKEIP_TEST_DOMAIN = "fakeip.podkop.fyi";' "$SINGBOX_CONSTANTS_UC" ||
  fail "sing-box constants must match the deployed FakeIP endpoint"
grep -Fq "export const FAKEIP_CHECK_DOMAIN = 'fakeip.podkop.fyi';" "$FRONTEND_CONSTANTS" ||
  fail "LuCI diagnostics must use the deployed FakeIP endpoint"
grep -Fq "export const IP_CHECK_DOMAIN = 'ip.podkop.fyi';" "$FRONTEND_CONSTANTS" ||
  fail "LuCI diagnostics must use the deployed public IP endpoint"

# The generator writes external_controller and the diagnostics dial it, from
# two different constant tables, so they have to name the same port.
generator_port="$(ucode -L "$FORKOP_LIB" -e '
  let c = require("singbox.constants");
  print(c.CLASH_API_CONTROLLER_PORT, "
");
')"
[ "$generator_port" = "$(ucode -L "$FORKOP_LIB" "$CONSTANTS_UC" get SB_CLASH_API_CONTROLLER_PORT)" ] ||
  fail "sing-box and diagnostics disagree on the Clash API controller port"
if grep -Fq '":9090"' "$FORKOP_LIB/singbox/generator.uc"; then
  fail "the generator must take the Clash API port from singbox/constants.uc"
fi

# The Servers dialog refuses a listen port one of Forkop's own inbounds already
# binds, so it carries the numbers out of singbox/constants.uc. The runtime check
# reads them from there; the dialog cannot, so this is the only thing keeping the two
# lists on the same ports - without it a changed constant leaves the dialog quietly
# accepting a port that stops the whole service.
reserved_ports_backend="$(ucode -L "$FORKOP_LIB" -e '
  let c = require("singbox.constants");
  let ports = [];
  for (let name in [ "DNS_INBOUND_PORT", "TPROXY_INBOUND_PORT", "SOURCE_DNS_INBOUND_PORT",
      "SYSTEM_TPROXY_INBOUND_PORT", "SYSTEM_DNS_INBOUND_PORT", "SERVICE_MIXED_INBOUND_PORT",
      "CLASH_API_CONTROLLER_PORT" ])
    push(ports, "" + c[name]);
  print(join("\n", sort(ports)), "\n");
')"
reserved_ports_frontend="$(
  sed -n '/^const RESERVED_PORTS = \[$/,/^\];$/p' "$SERVER_JS" |
    sed -n 's/^  \["\([0-9]*\)".*$/\1/p' | sort
)"
[ -n "$reserved_ports_frontend" ] ||
  fail "the Servers tab must list the ports Forkop's own inbounds bind"
[ "$reserved_ports_backend" = "$reserved_ports_frontend" ] ||
  fail "$(printf 'the Servers tab reserved port list differs from singbox/constants.uc\nbackend:\n%s\nfrontend:\n%s' "$reserved_ports_backend" "$reserved_ports_frontend")"

# A section or server display name becomes a runtime tag verbatim, so both dialogs
# refuse the names Forkop already uses for its own listeners. LuCI cannot read ucode,
# so each tab carries the list - its own copy, because a browser caches every view
# module separately and an upgrade can leave an old one beside a new one, which is
# what importing a name across two of them cannot survive. Both copies are held
# against the core table here, which is what keeps them from drifting apart.
reserved_backend="$(ucode -L "$FORKOP_LIB" -e '
  let c = require("singbox.constants");
  let names = [];
  for (let name in c.RESERVED_TAGS)
    push(names, name);
  print(join("\n", sort(names)), "\n");
')"
for tab in server section; do
  reserved_frontend="$(
    sed -n '/^const RESERVED_RUNTIME_TAGS = new Set(\[$/,/^\]);$/p' \
      "$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/$tab.js" |
      sed -n 's/^  "\([^"]*\)",$/\1/p' | sort
  )"
  [ -n "$reserved_frontend" ] ||
    fail "$tab.js must list the runtime tags its dialog refuses as a display name"
  [ "$reserved_backend" = "$reserved_frontend" ] ||
    fail "$(printf 'the reserved tag list in %s.js differs from singbox/constants.uc\nbackend:\n%s\nfrontend:\n%s' "$tab" "$reserved_backend" "$reserved_frontend")"
done

# Three tables name the community rule sets: the validator decides which
# references it accepts, singbox/rulesets.uc turns each one into a download URL,
# and the section dialog lists them. A name in only one of them is either
# refused by the validator, generated without a URL, or invisible in the UI.
community_validator="$(ucode -L "$FORKOP_LIB" "$CONSTANTS_UC" get COMMUNITY_SERVICES | tr ' ' '\n' | sed '/^$/d' | LC_ALL=C sort)"
community_generator="$(
  sed -n '/^const COMMUNITY_SERVICES = {$/,/^};$/p' "$FORKOP_LIB/singbox/rulesets.uc" |
    sed -n 's/^    \([a-z0-9_]*\): true,\?$/\1/p' | LC_ALL=C sort
)"
community_frontend="$(
  sed -n '/^export const DOMAIN_LIST_OPTIONS = {$/,/^};$/p' "$FRONTEND_CONSTANTS" |
    sed -n "s/^  \\([a-z0-9_]*\\): '.*',$/\\1/p" | LC_ALL=C sort
)"
[ -n "$community_generator" ] ||
  fail "singbox/rulesets.uc must list the community rule sets it can build a URL for"
[ -n "$community_frontend" ] ||
  fail "the section dialog must list the community rule sets it offers"
[ "$community_validator" = "$community_generator" ] ||
  fail "$(printf 'the community rule sets in core/constants.uc and singbox/rulesets.uc differ\nvalidator:\n%s\ngenerator:\n%s' "$community_validator" "$community_generator")"
[ "$community_validator" = "$community_frontend" ] ||
  fail "$(printf 'the community rule sets in core/constants.uc and fe-app-forkop/src/constants.ts differ\nbackend:\n%s\nfrontend:\n%s' "$community_validator" "$community_frontend")"

printf 'constants ownership checks passed\n'
