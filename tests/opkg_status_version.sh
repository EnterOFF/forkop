#!/usr/bin/env bash
# Reading a version used to mean `opkg list-installed`, which takes opkg's own
# lock - so a background version read could make somebody else's opkg command
# fail with "Could not lock /var/lock/opkg.lock". The status file is what that
# command reads anyway and needs no lock, so the parse of it has to be right.
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
PACKAGES_UC="$FORKOP_LIB/core/packages.uc"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_eq() {
  [ "$2" = "$1" ] || fail "$3: expected '$1', got '$2'"
}

status_version() {
  ucode -L "$FORKOP_LIB" "$PACKAGES_UC" opkg-status-version "$WORK_DIR/status" "$1"
}

# Shaped like the real file: stanzas separated by blank lines, in the order opkg
# writes them.
cat >"$WORK_DIR/status" <<'STATUS'
Package: libc
Version: 1.2.5-r4
Status: install ok installed

Package: forkop
Version: 1.0.5
Depends: libc, curl
Status: install user installed

Package: luci-app-passwall
Version: 4.0.0
Status: install ok not-installed

Package: zapret
Version: 72.20260307-r1
Status: install hold installed

Package: byedpi
Version: 0.17
Status: install prefer,user not-installed
STATUS

assert_eq "1.0.5" "$(status_version forkop)" "an installed package reports its version"
assert_eq "1.2.5-r4" "$(status_version libc)" "the first stanza is read"
assert_eq "72.20260307-r1" "$(status_version zapret)" "a held package is still installed"

# "not-installed" ends in "installed", so a substring check would call every one
# of these present. This router carries four such stanzas.
assert_eq "" "$(status_version luci-app-passwall)" "a not-installed package reports nothing"
assert_eq "" "$(status_version byedpi)" "a not-installed package with flags reports nothing"

assert_eq "" "$(status_version absent)" "a package with no stanza reports nothing"
# A name that is a prefix of another must not match it.
assert_eq "" "$(status_version fork)" "a partial name does not match a package"

# A file whose last stanza has no trailing blank line still has to answer.
printf 'Package: tailpkg\nVersion: 9.9\nStatus: install ok installed' >"$WORK_DIR/status"
assert_eq "9.9" "$(status_version tailpkg)" "the last stanza needs no trailing blank line"


# The lookup has to read the status file, and the one remaining
# `opkg list-installed` has to be the fallback for a layout that keeps the status
# elsewhere - so it may only be reachable after that read has failed.
grep -q 'fs.readfile(OPKG_STATUS_FILE)' "$PACKAGES_UC" ||
  fail "the version lookup must read the opkg status file"

listed_count="$(grep -c 'opkg", "list-installed' "$PACKAGES_UC")"
[ "$listed_count" = "1" ] ||
  fail "expected one opkg list-installed fallback, found $listed_count"

status_line="$(grep -n 'fs.readfile(OPKG_STATUS_FILE)' "$PACKAGES_UC" | head -n1 | cut -d: -f1)"
listed_line="$(grep -n 'opkg", "list-installed' "$PACKAGES_UC" | cut -d: -f1)"
[ "$listed_line" -gt "$status_line" ] ||
  fail "opkg list-installed must only be reached when the status file cannot be read"

printf 'opkg status version checks passed\n'
