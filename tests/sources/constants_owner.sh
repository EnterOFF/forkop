#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
FORKOP_MAKEFILE="$ROOT_DIR/forkop/Makefile"
BUILD_SCRIPT="$ROOT_DIR/build.sh"
LIFECYCLE_UC="$FORKOP_LIB/service/lifecycle.uc"
SINGBOX_CONSTANTS_UC="$FORKOP_LIB/singbox/constants.uc"
RULESETS_UC="$FORKOP_LIB/singbox/rulesets.uc"
FRONTEND_CONSTANTS="$ROOT_DIR/fe-app-forkop/src/constants.ts"
VIEW_DIR="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop"
TABS_DIR="$ROOT_DIR/fe-app-forkop/src/forkop/tabs"
LITERAL_READER="$TESTS_DIR/lib/source_literal.js"

# Every table below is read by evaluating the module that owns it and by reading the
# literal the copy is written as. Both sides answer for what the code actually holds,
# so a reflowed list either compares equal or names what moved - it cannot come back
# empty and agree with an empty expectation.
read_literal() {
  node "$LITERAL_READER" "$@" ||
    fail "could not read $2 from $1"
}

grep -Fq 'core.constants' "$LIFECYCLE_UC" ||
  fail "service/lifecycle.uc must load constants from core/constants.uc"

grep -Fq 'core/constants.uc' "$FORKOP_MAKEFILE" ||
  fail "forkop/Makefile must patch core/constants.uc"
grep -Fq 'core/constants.uc' "$BUILD_SCRIPT" ||
  fail "release build must patch core/constants.uc"

grep -Fq 'const FAKEIP_TEST_DOMAIN = "fakeip.podkop.fyi";' "$SINGBOX_CONSTANTS_UC" ||
  fail "sing-box constants must match the deployed FakeIP endpoint"
grep -Fq "export const FAKEIP_CHECK_DOMAIN = 'fakeip.podkop.fyi';" "$FRONTEND_CONSTANTS" ||
  fail "LuCI diagnostics must use the deployed FakeIP endpoint"
grep -Fq "export const IP_CHECK_DOMAIN = 'ip.podkop.fyi';" "$FRONTEND_CONSTANTS" ||
  fail "LuCI diagnostics must use the deployed public IP endpoint"

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
reserved_ports_frontend="$(read_literal "$TABS_DIR/servers/constants.ts" RESERVED_PORTS heads | LC_ALL=C sort)"
[ "$reserved_ports_backend" = "$reserved_ports_frontend" ] ||
  fail "$(printf 'the Servers tab reserved port list differs from singbox/constants.uc\nbackend:\n%s\nfrontend:\n%s' "$reserved_ports_backend" "$reserved_ports_frontend")"

# A section or server display name becomes a runtime tag verbatim, so both
# dialogs refuse the names Forkop already uses for its own listeners. LuCI cannot
# read ucode, so the front end carries the list; this is what keeps its copy and
# the core table from drifting apart.
reserved_backend="$(ucode -L "$FORKOP_LIB" -e '
  let c = require("singbox.constants");
  for (let name in c.RESERVED_TAGS)
    print(name, "\n");
' | LC_ALL=C sort)"
[ -n "$reserved_backend" ] ||
  fail "singbox/constants.uc must publish the tags Forkop uses for its own listeners"
reserved_frontend="$(read_literal "$FRONTEND_CONSTANTS" RESERVED_RUNTIME_TAGS | LC_ALL=C sort)"
[ "$reserved_backend" = "$reserved_frontend" ] ||
  fail "$(printf 'the reserved tag list in %s differs from singbox/constants.uc\nbackend:\n%s\nfrontend:\n%s' "$FRONTEND_CONSTANTS" "$reserved_backend" "$reserved_frontend")"

# One tab must not go back to keeping a copy of its own: both are modules of one
# bundle, which the browser loads whole or not at all.
if grep -rn 'RESERVED_RUNTIME_TAGS = ' "$TABS_DIR" >/dev/null 2>&1; then
  fail "the reserved tag list belongs in the shared constants, not in a tab"
fi

# The section dialog lists the community rule sets singbox/rulesets.uc names,
# which the validator accepts and the generator downloads. A name the dialog
# lacks is invisible; one only the dialog has is refused on save.
community_validator="$(read_literal "$RULESETS_UC" COMMUNITY_SERVICES | LC_ALL=C sort)"
community_frontend="$(read_literal "$FRONTEND_CONSTANTS" DOMAIN_LIST_OPTIONS | LC_ALL=C sort)"
[ -n "$community_validator" ] ||
  fail "singbox/rulesets.uc must list the community rule sets"
[ "$community_validator" = "$community_frontend" ] ||
  fail "$(printf 'the community rule sets in singbox/rulesets.uc and fe-app-forkop/src/constants.ts differ\nbackend:\n%s\nfrontend:\n%s' "$community_validator" "$community_frontend")"

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
