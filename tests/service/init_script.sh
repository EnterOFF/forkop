#!/usr/bin/env bash
# The init script is shell that procd runs, and the command line it calls is
# ucode: the two meet only through the command names and the autostart link.
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
INIT="$FORKOP_FILES/etc/init.d/forkop"
CLI_UC="$FORKOP_LIB/service/cli.uc"

priority="$(sed -n 's/^START=\([0-9]*\)$/\1/p' "$INIT")"
[ -n "$priority" ] || fail "the init script must declare a START priority"
# Autostart is toggled by writing the rc.d link directly, so every reader of it
# has to name the link the init script's enable would have made.
grep -Fq "const AUTOSTART_PRIORITY = \"$priority\";" "$FORKOP_LIB/service/lifecycle.uc" ||
  fail "the lifecycle's autostart link must carry the init script's START $priority"
grep -Fq "\"/etc/rc.d/S${priority}forkop\"" "$FORKOP_LIB/service/initd.uc" ||
  fail "the WAN retry must read the autostart link of START $priority"
grep -Fq "\"/S${priority}forkop\"" "$FORKOP_LIB/service/ui.uc" ||
  fail "the page must read the autostart link of START $priority"

# Every hook calls a command the CLI defines, with no module path in between.
hooks="$(grep -o '"\$FORKOP_BIN" [a-z_]*' "$INIT" | awk '{ print $2 }' | sort -u)"
[ "$(printf '%s\n' "$hooks" | wc -l)" -ge 8 ] || fail "the init script must reach every hook through the CLI, found: $hooks"
for hook in $hooks; do
  grep -Eq "^    $hook: \{" "$CLI_UC" || fail "the init script calls $hook, which service/cli.uc does not define"
done

# rc.common reports a start and a stop by the status of its own hooks.
grep -Fq 'FORKOP_LAST_START_STATUS="$?"' "$INIT" && grep -Fq 'service_started()' "$INIT" ||
  fail "a failed start must reach rc.common through service_started"
grep -Fq 'FORKOP_LAST_STOP_STATUS="$?"' "$INIT" && grep -Fq 'service_stopped()' "$INIT" ||
  fail "a failed stop must reach rc.common through service_stopped"

printf 'init script checks passed\n'
