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

# A server name becomes an inbound tag verbatim, so the Servers dialog refuses the
# names Forkop already uses for its own listeners. LuCI cannot read ucode, so the
# list is a copy; a tag added to the core table and not to that copy would let the
# dialog accept a name the runtime check then rejects.
reserved_backend="$(ucode -L "$FORKOP_LIB" -e '
  let c = require("singbox.constants");
  let names = [];
  for (let name in c.RESERVED_TAGS)
    push(names, name);
  print(join("\n", sort(names)), "\n");
')"
reserved_frontend="$(
  sed -n '/^const RESERVED_RUNTIME_TAGS = new Set(\[$/,/^\]);$/p' \
    "$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/server.js" |
    sed -n 's/^  "\([^"]*\)",$/\1/p' | sort
)"
[ -n "$reserved_frontend" ] ||
  fail "the Servers tab must list the runtime tags it refuses as server names"
[ "$reserved_backend" = "$reserved_frontend" ] ||
  fail "$(printf 'the Servers tab reserved tag list differs from singbox/constants.uc\nbackend:\n%s\nfrontend:\n%s' "$reserved_backend" "$reserved_frontend")"

printf 'constants ownership checks passed\n'
