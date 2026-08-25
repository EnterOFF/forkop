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
RULESETS_UC="$FORKOP_LIB/singbox/rulesets.uc"
FRONTEND_CONSTANTS="$ROOT_DIR/fe-app-forkop/src/constants.ts"
VIEW_DIR="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop"
SERVER_JS="$VIEW_DIR/server.js"
LITERAL_READER="$ROOT_DIR/tests/helpers/source_literal.js"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

# Every table below is read by evaluating the module that owns it and by reading the
# literal the copy is written as. Both sides answer for what the code actually holds,
# so a reflowed list either compares equal or names what moved - it cannot come back
# empty and agree with an empty expectation.
read_literal() {
  node "$LITERAL_READER" "$@" ||
    fail "could not read $2 from $1"
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
#
# The expectation is every port the table publishes rather than a list of constant
# names repeated here, because such a list is a third copy: a new inbound would be
# missing from it and from the dialog at the same time and this check would pass.
reserved_ports_backend="$(ucode -L "$FORKOP_LIB" -e '
  let c = require("singbox.constants");
  let ports = {};
  for (let name in c)
    if (match(name, /_INBOUND_PORT$/) != null)
      ports["" + c[name]] = true;
  ports["" + c.CLASH_API_CONTROLLER_PORT] = true;
  for (let port in ports)
    print(port, "\n");
' | LC_ALL=C sort)"
[ -n "$reserved_ports_backend" ] ||
  fail "singbox/constants.uc must publish the ports Forkop's own inbounds bind"
reserved_ports_frontend="$(read_literal "$SERVER_JS" RESERVED_PORTS heads | LC_ALL=C sort)"
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
  for (let name in c.RESERVED_TAGS)
    print(name, "\n");
' | LC_ALL=C sort)"
[ -n "$reserved_backend" ] ||
  fail "singbox/constants.uc must publish the tags Forkop uses for its own listeners"
for tab in server section; do
  reserved_frontend="$(read_literal "$VIEW_DIR/$tab.js" RESERVED_RUNTIME_TAGS | LC_ALL=C sort)"
  [ "$reserved_backend" = "$reserved_frontend" ] ||
    fail "$(printf 'the reserved tag list in %s.js differs from singbox/constants.uc\nbackend:\n%s\nfrontend:\n%s' "$tab" "$reserved_backend" "$reserved_frontend")"
done

# Three tables name the community rule sets: the validator decides which
# references it accepts, singbox/rulesets.uc turns each one into a download URL,
# and the section dialog lists them. A name in only one of them is either
# refused by the validator, generated without a URL, or invisible in the UI.
community_validator="$(ucode -L "$FORKOP_LIB" "$CONSTANTS_UC" get COMMUNITY_SERVICES | tr ' ' '\n' | sed '/^$/d' | LC_ALL=C sort)"
community_generator="$(read_literal "$RULESETS_UC" COMMUNITY_SERVICES | LC_ALL=C sort)"
community_frontend="$(read_literal "$FRONTEND_CONSTANTS" DOMAIN_LIST_OPTIONS | LC_ALL=C sort)"
[ -n "$community_validator" ] ||
  fail "core/constants.uc must list the community rule sets the validator accepts"
[ "$community_validator" = "$community_generator" ] ||
  fail "$(printf 'the community rule sets in core/constants.uc and singbox/rulesets.uc differ\nvalidator:\n%s\ngenerator:\n%s' "$community_validator" "$community_generator")"
[ "$community_validator" = "$community_frontend" ] ||
  fail "$(printf 'the community rule sets in core/constants.uc and fe-app-forkop/src/constants.ts differ\nbackend:\n%s\nfrontend:\n%s' "$community_validator" "$community_frontend")"

# Equal tables are not the whole contract: the generator still has to answer for
# every name the validator accepts. A name it does not recognise reaches sing-box
# as a rule set with no source, and two names sharing a URL would download one
# list under two tags.
community_urls="$(FORKOP_COMMUNITY_NAMES="$community_validator" ucode -L "$FORKOP_LIB" -e '
  let rulesets = require("singbox.rulesets");
  let names = split(getenv("FORKOP_COMMUNITY_NAMES"), "\n");
  for (let name in names) {
    if (name == "")
      continue;
    if (!rulesets.is_community(name)) {
      print("unknown ", name, "\n");
      continue;
    }
    print(rulesets.community_url(name), "\n");
  }
')"
unknown="$(printf '%s\n' "$community_urls" | sed -n 's/^unknown //p')"
[ -z "$unknown" ] ||
  fail "$(printf 'singbox/rulesets.uc does not recognise these community rule sets:\n%s' "$unknown")"
if printf '%s\n' "$community_urls" | grep -q '^$'; then
  fail "every community rule set must resolve to a download URL"
fi
duplicate_urls="$(printf '%s\n' "$community_urls" | LC_ALL=C sort | uniq -d)"
[ -z "$duplicate_urls" ] ||
  fail "$(printf 'two community rule sets share a download URL:\n%s' "$duplicate_urls")"

printf 'constants ownership checks passed\n'
