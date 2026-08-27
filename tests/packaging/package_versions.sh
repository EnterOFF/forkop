#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
PACKAGES_UC="${PACKAGES_UC:-$ROOT_DIR/forkop/files/usr/lib/core/packages.uc}"

cat >"$WORK_DIR/apk" <<'SH'
#!/usr/bin/env sh
set -eu

case "$*" in
  "info -e sing-box-forkop"|"info -e sing-box-forkop-compressed")
    exit 0
    ;;
  "info -e zapret")
    exit 0
    ;;
  "list --installed --manifest zapret"|"list --installed --manifest")
    exit 1
    ;;
  "list --installed zapret")
    if [ "${FAKE_APK_LIST_EMPTY:-0}" = "1" ]; then
      exit 1
    fi
    printf '<zapret> zapret-72.20260307-r1 aarch64_cortex-a53 {feeds/base/zapret} [installed]\n'
    ;;
  "list --installed sing-box-forkop"|"list --installed sing-box-forkop-compressed")
    printf '<sing-box> %s-1.13.14.2.5.3.1-r0 aarch64_cortex-a53 {local} [installed]\n' "${3}"
    ;;
  "info -v zapret")
    printf 'zapret: zapret\n'
    ;;
  "list --available --manifest example-package")
    if [ -n "${FAKE_APK_LOG:-}" ]; then
      printf '%s\n' "$*" >>"$FAKE_APK_LOG"
    fi
    exit 0
    ;;
  "query --from repositories --available --format json --fields name,version example-package")
    printf '%s\n' "$*" >>"${FAKE_APK_LOG:?}"
    case "${FAKE_APK_QUERY_RESULT:-valid}" in
      valid) printf '%s\n' '[{"name":"example-package","version":"1.12.17-r1"}]' ;;
      empty) printf '%s\n' '[]' ;;
      malformed) printf '%s\n' 'not-json' ;;
      wrong-name) printf '%s\n' '[{"name":"sing-box","version":"9.9.9-r1"}]' ;;
      provider-first) printf '%s\n' '[{"name":"unrelated-package","version":"9.9.9-r1"},{"name":"example-package","version":"1.12.17-r1"}]' ;;
    esac
    ;;
  *)
    exit 1
    ;;
esac
SH
chmod +x "$WORK_DIR/apk"

version="$(PATH="$WORK_DIR:$PATH" ucode "$PACKAGES_UC" apk-version zapret)"
[ "$version" = "72.20260307-r1" ] ||
  fail "APK v3 installed package version was parsed as '$version'"

invalid_version="$(FAKE_APK_LIST_EMPTY=1 PATH="$WORK_DIR:$PATH" ucode "$PACKAGES_UC" apk-version zapret)"
[ -z "$invalid_version" ] ||
  fail "APK v3 description was accepted as package version '$invalid_version'"

printf '%s\n' '1.13.14-extended-2.5.3-f1' > "$WORK_DIR/sing-box-forkop.version"
canonical_version="$(SING_BOX_FORKOP_VERSION_FILE="$WORK_DIR/sing-box-forkop.version" PATH="$WORK_DIR:$PATH" ucode "$PACKAGES_UC" version sing-box-forkop)"
[ "$canonical_version" = '1.13.14-extended-2.5.3-f1' ] ||
  fail "sing-box-forkop canonical package version was parsed as '$canonical_version'"
compressed_version="$(SING_BOX_FORKOP_VERSION_FILE="$WORK_DIR/sing-box-forkop.version" PATH="$WORK_DIR:$PATH" ucode "$PACKAGES_UC" version sing-box-forkop-compressed)"
[ "$compressed_version" = '1.13.14-extended-2.5.3-f1' ] ||
  fail "compressed sing-box-forkop canonical package version was parsed as '$compressed_version'"

printf '%s\n' '1.13.14-extended-2.5.2-forkop.14' > "$WORK_DIR/sing-box-forkop.version"
legacy_canonical_version="$(SING_BOX_FORKOP_VERSION_FILE="$WORK_DIR/sing-box-forkop.version" PATH="$WORK_DIR:$PATH" ucode "$PACKAGES_UC" version sing-box-forkop)"
[ "$legacy_canonical_version" = '1.13.14-extended-2.5.2-forkop.14' ] ||
  fail "legacy sing-box-forkop canonical package version was parsed as '$legacy_canonical_version'"

printf '%s\n' '1.13.14.2.5.3.1-r0' > "$WORK_DIR/sing-box-forkop.version"
invalid_canonical_version="$(SING_BOX_FORKOP_VERSION_FILE="$WORK_DIR/sing-box-forkop.version" PATH="$WORK_DIR:$PATH" ucode "$PACKAGES_UC" version sing-box-forkop)"
[ -z "$invalid_canonical_version" ] ||
  fail "invalid sing-box-forkop canonical version was accepted as '$invalid_canonical_version'"

rm -f "$WORK_DIR/sing-box-forkop.version"
legacy_version="$(SING_BOX_FORKOP_VERSION_FILE="$WORK_DIR/sing-box-forkop.version" PATH="$WORK_DIR:$PATH" ucode "$PACKAGES_UC" version sing-box-forkop)"
[ "$legacy_version" = '1.13.14.2.5.3.1-r0' ] ||
  fail "legacy sing-box-forkop APK metadata fallback was parsed as '$legacy_version'"

: >"$WORK_DIR/apk.log"
available_version="$(FAKE_APK_LOG="$WORK_DIR/apk.log" PATH="$WORK_DIR:$PATH" ucode "$PACKAGES_UC" apk-available-version example-package)"
[ "$available_version" = "1.12.17-r1" ] ||
  fail "APK v3 available package version was parsed as '$available_version'"
grep -Fxq 'query --from repositories --available --format json --fields name,version example-package' "$WORK_DIR/apk.log" ||
  fail "APK available version lookup must query repository packages explicitly"
if grep -Fq 'list --available --manifest example-package' "$WORK_DIR/apk.log"; then
  fail "APK available version lookup must not use installed-only manifest mode"
fi

provider_version="$(FAKE_APK_QUERY_RESULT=provider-first FAKE_APK_LOG="$WORK_DIR/apk.log" PATH="$WORK_DIR:$PATH" ucode "$PACKAGES_UC" apk-available-version example-package)"
[ "$provider_version" = "1.12.17-r1" ] ||
  fail "APK provider result replaced the exact package version '$provider_version'"

for result in empty malformed wrong-name; do
  invalid_available_version="$(FAKE_APK_QUERY_RESULT="$result" FAKE_APK_LOG="$WORK_DIR/apk.log" PATH="$WORK_DIR:$PATH" ucode "$PACKAGES_UC" apk-available-version example-package)"
  [ -z "$invalid_available_version" ] ||
    fail "APK v3 $result query result was accepted as version '$invalid_available_version'"
done

printf 'Package version checks passed\n'
