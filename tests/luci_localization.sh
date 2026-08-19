#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js"
FORKOP_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/forkop.js"
PO="$ROOT_DIR/luci-app-forkop/po/ru/forkop.po"
POT="$ROOT_DIR/luci-app-forkop/po/templates/forkop.pot"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

[ ! -e "$ROOT_DIR/fe-app-forkop/locales" ] ||
  fail "translation catalogs must live only under luci-app-forkop/po"

if grep -Fq '_("Dismiss")' "$SECTION_JS"; then
  fail "Forkop modals must use Close instead of the shared LuCI Dismiss key"
fi
grep -Fq '_("Close")' "$SECTION_JS" ||
  fail "Forkop section settings modal must expose a Close action"

if grep -Fq 'http(s)://, hy2/hysteria2:// links' "$SECTION_JS" "$PO" "$POT"; then
  fail "Connection URL help must not advertise removed HTTP proxy links"
fi
grep -Fq 'Supported links: vless, vmess, shadowsocks, trojan, socks, http, tuic, hysteria, naiveproxy, mieru' "$SECTION_JS" ||
  fail "Connection URL help must summarize the supported proxy link types"
if grep -Fq 'Native sing-box links:' "$SECTION_JS"; then
  fail "Connection URL help must start with examples"
fi
grep -Fq 'querySelector?.(".placeholder em")' "$FORKOP_JS" ||
  fail "empty sections text must preserve the LuCI table cell"
grep -Fq 'What Forkop should do when this section'"'"'s conditions match' "$SECTION_JS" ||
  fail "section action help must mention matching conditions"
if grep -Fq 'Visible name of this section' "$SECTION_JS"; then
  fail "section name must not keep the redundant description"
fi

awk '
  $0 == "msgid \"Close\"" {
    getline
    if ($0 == "msgstr \"Закрыть\"")
      found = 1
  }
  END { exit found ? 0 : 1 }
' "$PO" || fail "Close must be translated as Закрыть"

if awk '
  $0 == "msgid \"Dismiss\"" {
    getline
    if ($0 == "msgstr \"Отмена\"")
      bad = 1
  }
  END { exit bad ? 0 : 1 }
' "$PO"; then
  fail "Dismiss must not override LuCI alert closing with Отмена"
fi

awk '
  $0 ~ /^msgid "/ && $0 != "msgid \"\"" {
    msgid = $0
    getline
    if ($0 == "msgstr \"\"") {
      print "untranslated: " msgid
      missing = 1
    }
  }
  END { exit missing ? 1 : 0 }
' "$PO" || fail "Russian catalog must not leave user-facing strings untranslated"

printf 'LuCI localization checks passed\n'
