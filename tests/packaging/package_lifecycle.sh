#!/usr/bin/env bash
set -eo pipefail

# The package scripts only hand over to the forkop command line, whose hooks
# are service/package.uc (tests/unit/service/package.test.uc).

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
FORKOP_MAKEFILE="$ROOT_DIR/forkop/Makefile"
LUCI_UCI_DEFAULTS="$ROOT_DIR/luci-app-forkop/root/etc/uci-defaults/50_luci-forkop"
BUILD_SCRIPT="$ROOT_DIR/build.sh"

grep -Fq '#!/bin/sh' "$LUCI_UCI_DEFAULTS" ||
  fail "LuCI uci-defaults must remain a shell script because OpenWrt default_postinst runs it through shell"
grep -Fq '/usr/bin/forkop luci_postinst' "$LUCI_UCI_DEFAULTS" ||
  fail "LuCI uci-defaults must delegate cache/rpcd handling to ucode"
if grep -E 'rm -f /var/luci-indexcache|rm -f /tmp/luci-indexcache|logger -t "forkop"' "$LUCI_UCI_DEFAULTS" >/dev/null; then
  fail "LuCI uci-defaults must not own cache/logger shell logic"
fi

if grep -n -E 'grep -q "105 forkop"|sed -i "/105 forkop|forkop_dont_touch_dhcp=.*uci|cp /etc/config/forkop|rm -f /tmp/luci-indexcache|killall -HUP rpcd' "$FORKOP_MAKEFILE" "$BUILD_SCRIPT" >/dev/null; then
  fail "package scripts must not keep backend/LuCI lifecycle business logic in shell"
fi
grep -Fq '#!/usr/bin/ucode' "$FORKOP_MAKEFILE" ||
  fail "forkop Makefile package hooks must use ucode entrypoints"
grep -Fq '/usr/bin/forkop package_prerm' "$FORKOP_MAKEFILE" ||
  fail "forkop Makefile prerm must delegate cleanup to package_prerm"
grep -Fq '/usr/bin/forkop package_postinst' "$FORKOP_MAKEFILE" ||
  fail "forkop Makefile postinst must restore a service that was running before upgrade"
grep -Fq '/usr/bin/forkop package_prerm upgrade' "$BUILD_SCRIPT" ||
  fail "manual APK pre-upgrade must record and stop the running service"
grep -Fq '/usr/bin/forkop package_postinst' "$BUILD_SCRIPT" ||
  fail "manual packages must restore a service that was running before upgrade"
[ "$(grep -c '/usr/bin/forkop luci_prerm' "$BUILD_SCRIPT")" -eq 2 ] ||
  fail "the LuCI app must stop the state service on removal in both the IPK and the APK package"
if grep -Fq '/usr/bin/forkop luci_postinst' "$BUILD_SCRIPT"; then
  fail "manual package hooks must let default_postinst run luci_postinst exactly once through uci-defaults"
fi
if grep -n -E 'Package/forkop/preinst|copy_legacy_config|FORKOP_LEGACY_CONFIG' "$FORKOP_MAKEFILE" "$BUILD_SCRIPT" >/dev/null 2>&1; then
  fail "package hooks must not own configuration migration"
fi

# A command in the few seconds before postinst leaves a fresh validation stamp
# behind, and the launcher trusts it without looking at the files the install
# has just replaced, so postinst would run the previous release's hooks from the
# old bytecode. Postinst has to validate the cache in full.
if grep -h 'forkop package_postinst' "$FORKOP_MAKEFILE" "$BUILD_SCRIPT" | grep -v 'FORKOP_BYTECODE_VALIDATION_TTL=0 /usr/bin/forkop package_postinst' >/dev/null; then
  fail "every postinst must run package_postinst with FORKOP_BYTECODE_VALIDATION_TTL=0"
fi

printf 'package lifecycle checks passed\n'
