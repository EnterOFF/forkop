#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
FORKOP_BIN="$ROOT_DIR/forkop/files/usr/bin/forkop"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

SOURCE_DIR="$WORK_DIR/lib"
CACHE_DIR="$WORK_DIR/cache"
mkdir -p "$SOURCE_DIR/core" "$SOURCE_DIR/config" "$SOURCE_DIR/service"

# A miniature library: one leaf module the cache self-check loads, one module
# that imports it, one entry script, and one non-module payload file.
cat >"$SOURCE_DIR/config/domain.uc" <<'UCODE'
#!/usr/bin/env ucode
return { marker: "domain-v1" };
UCODE

cat >"$SOURCE_DIR/core/probe.uc" <<'UCODE'
#!/usr/bin/env ucode
let domain = require("config.domain");
return { marker: "probe-" + domain.marker };
UCODE

cat >"$SOURCE_DIR/service/entry.uc" <<'UCODE'
#!/usr/bin/env ucode
let probe = require("core.probe");
print(probe.marker, "\n");
UCODE

printf 'payload\n' >"$SOURCE_DIR/core/payload.txt"

resolve() {
  FORKOP_SOURCE_LIB="$SOURCE_DIR" FORKOP_BYTECODE_CACHE_DIR="$CACHE_DIR" \
    ${1:+FORKOP_BYTECODE_CACHE="$1"} \
    ucode -L "$FORKOP_LIB" -e '
      let bytecode = require("core.bytecode");
      print(bytecode.refresh(), "\n");
    '
}

resolve_only() {
  FORKOP_SOURCE_LIB="$SOURCE_DIR" FORKOP_BYTECODE_CACHE_DIR="$CACHE_DIR" \
    ucode -L "$FORKOP_LIB" -e '
      let bytecode = require("core.bytecode");
      print(bytecode.library_dir(), "\n");
    '
}

is_bytecode() {
  head -c 32 "$1" | grep -Fq $'\x1bucb'
}

built="$(resolve)"
[ "$built" != "$SOURCE_DIR" ] ||
  fail "a healthy library must compile into a cache directory"
[ -f "$CACHE_DIR/manifest" ] ||
  fail "a published cache must leave a manifest behind"

for module in config/domain.uc core/probe.uc service/entry.uc; do
  [ -f "$built/$module" ] ||
    fail "cache must carry $module"
  is_bytecode "$built/$module" ||
    fail "$module must be stored as bytecode"
done

# Files that are not modules are still needed by whatever reads them relative to
# the library directory, so they are carried over verbatim.
[ "$(cat "$built/core/payload.txt")" = "payload" ] ||
  fail "non-module files must be copied into the cache unchanged"

# What matters is that the cached library behaves exactly like the sources, both
# for `require` resolution and for an entry script executed by path.
source_out="$(ucode -L "$SOURCE_DIR" "$SOURCE_DIR/service/entry.uc")"
cache_out="$(ucode -L "$built" "$built/service/entry.uc")"
[ "$source_out" = "probe-domain-v1" ] ||
  fail "source library must print probe-domain-v1, got '$source_out'"
[ "$cache_out" = "$source_out" ] ||
  fail "cached library must behave like the sources: '$cache_out' != '$source_out'"

# A second resolve must reuse the published cache instead of compiling again.
reused="$(resolve)"
[ "$reused" = "$built" ] ||
  fail "an up-to-date cache must be reused, got '$reused' instead of '$built'"

# Editing an installed module is how a module gets copied onto a router during
# development. The manifest records size and mtime, so the stale cache has to be
# rejected and rebuilt rather than silently kept.
sleep 1
cat >"$SOURCE_DIR/config/domain.uc" <<'UCODE'
#!/usr/bin/env ucode
return { marker: "domain-v2" };
UCODE

stale="$(resolve_only)"
[ "$stale" = "$SOURCE_DIR" ] ||
  fail "a cache built from replaced sources must not be resolved, got '$stale'"

rebuilt="$(resolve)"
[ "$rebuilt" != "$SOURCE_DIR" ] && [ "$rebuilt" != "$built" ] ||
  fail "replaced sources must produce a new cache directory, got '$rebuilt'"
rebuilt_out="$(ucode -L "$rebuilt" "$rebuilt/service/entry.uc")"
[ "$rebuilt_out" = "probe-domain-v2" ] ||
  fail "rebuilt cache must carry the new sources, got '$rebuilt_out'"

# A newer interpreter writes a bytecode format the running one refuses, so the
# recorded interpreter identity has to invalidate the cache as well.
FAKE_UCODE_DIR="$WORK_DIR/bin"
mkdir -p "$FAKE_UCODE_DIR"
printf '#!/bin/sh\nexec %s "$@"\n' "$(command -v ucode)" >"$FAKE_UCODE_DIR/ucode"
chmod +x "$FAKE_UCODE_DIR/ucode"
with_fake_ucode="$(
  FORKOP_SOURCE_LIB="$SOURCE_DIR" FORKOP_BYTECODE_CACHE_DIR="$CACHE_DIR" \
    FORKOP_UCODE_BIN="$FAKE_UCODE_DIR/ucode" \
    ucode -L "$FORKOP_LIB" -e '
      let bytecode = require("core.bytecode");
      print(bytecode.library_dir(), "\n");
    '
)"
[ "$with_fake_ucode" = "$SOURCE_DIR" ] ||
  fail "a different interpreter must invalidate the cache, got '$with_fake_ucode'"

# The cache is an optimisation: switching it off has to leave the sources in
# charge without touching anything on disk.
disabled_cache_dir="$WORK_DIR/cache-disabled"
disabled="$(
  FORKOP_SOURCE_LIB="$SOURCE_DIR" FORKOP_BYTECODE_CACHE_DIR="$disabled_cache_dir" \
    FORKOP_BYTECODE_CACHE=0 \
    ucode -L "$FORKOP_LIB" -e '
      let bytecode = require("core.bytecode");
      print(bytecode.refresh(), "\n");
    '
)"
[ "$disabled" = "$SOURCE_DIR" ] ||
  fail "FORKOP_BYTECODE_CACHE=0 must resolve to the sources, got '$disabled'"
[ ! -e "$disabled_cache_dir" ] ||
  fail "FORKOP_BYTECODE_CACHE=0 must not create a cache directory"

# A library that cannot be compiled must not take the service down with it: the
# broken module still has to be present under the cache so `require` keeps
# reporting the real syntax error instead of a missing file.
BROKEN_DIR="$WORK_DIR/broken"
BROKEN_CACHE="$WORK_DIR/broken-cache"
mkdir -p "$BROKEN_DIR/config" "$BROKEN_DIR/core"
cp "$SOURCE_DIR/config/domain.uc" "$BROKEN_DIR/config/domain.uc"
printf 'this is ( not ucode\n' >"$BROKEN_DIR/core/broken.uc"
broken="$(
  FORKOP_SOURCE_LIB="$BROKEN_DIR" FORKOP_BYTECODE_CACHE_DIR="$BROKEN_CACHE" \
    ucode -L "$FORKOP_LIB" -e '
      let bytecode = require("core.bytecode");
      print(bytecode.refresh(), "\n");
    '
)"
[ -f "$broken/core/broken.uc" ] ||
  fail "a module that fails to compile must still be present in the cache"
is_bytecode "$broken/core/broken.uc" &&
  fail "a module that fails to compile must be copied as source, not as bytecode"

# The entrypoint keeps honouring an explicit FORKOP_LIB, which is what tests and
# manual overrides rely on and what every child process is handed.
mkdir -p "$WORK_DIR/fake/diagnostics"
cat >"$WORK_DIR/fake/diagnostics/runtime.uc" <<'UCODE'
#!/usr/bin/env ucode
print(getenv("FORKOP_LIB") || "unset", "\n");
UCODE
forwarded="$(FORKOP_LIB="$WORK_DIR/fake" ucode "$FORKOP_BIN" show_version)"
[ "$forwarded" = "$WORK_DIR/fake" ] ||
  fail "entrypoint must export the resolved library to its children, got '$forwarded'"

# An exported FORKOP_LIB reaches every descendant, so the init script must not
# pin the source directory: that is what silently switched the whole procd path
# back to parsing sources on each reload.
INITD="$ROOT_DIR/forkop/files/etc/init.d/forkop"
if grep -Eq '^[[:space:]]*FORKOP_LIB="\$FORKOP_LIB"[[:space:]]*\\?$' "$INITD"; then
  fail "init script must not export FORKOP_LIB into service/initd.uc"
fi
grep -Fq 'bytecode.refresh()' "$ROOT_DIR/forkop/files/usr/lib/service/initd.uc" ||
  fail "service/initd.uc must resolve the library cache for the procd path"

printf 'Bytecode cache checks passed\n'
