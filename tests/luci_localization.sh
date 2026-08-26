#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$(node "$ROOT_DIR/tests/helpers/tab_source.js" sections)"
FORKOP_JS="$(node "$ROOT_DIR/tests/helpers/tab_source.js" entry --double-quotes)"
SERVER_JS="$(node "$ROOT_DIR/tests/helpers/tab_source.js" servers)"
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
grep -Fq "_('Close')" "$SECTION_JS" ||
  fail "Forkop section settings modal must expose a Close action"

if grep -Fq 'http(s)://, hy2/hysteria2:// links' "$SECTION_JS" "$PO" "$POT"; then
  fail "Connection URL help must not advertise removed HTTP proxy links"
fi
grep -Fq 'Supported URIs: vless, vmess, shadowsocks, trojan, socks, http, tuic, hysteria, naiveproxy, mieru, anytls' "$SECTION_JS" ||
  fail "Connection URI help must summarize the supported proxy URI types"
if grep -Fq 'Native sing-box links:' "$SECTION_JS"; then
  fail "Connection URL help must start with examples"
fi
grep -Fq 'querySelector?.(".placeholder em")' "$FORKOP_JS" ||
  fail "empty sections text must preserve the LuCI table cell"
grep -Fq 'What to do when this section'"'"'s conditions match' "$SECTION_JS" ||
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

# A row action button has to stay short, and LuCI's own catalog owns "Edit" and
# translates it as "Редактировать", which Forkop cannot override. So the button asks
# for a Forkop msgid and falls back to the English word when the catalog returns the
# msgid unchanged - which only works while the compared string is the msgid, and
# while the button is the only reader of it. Both grids show the button, so the
# helper belongs to the shared CBI layer rather than to either tab.
edit_label_definition="$(node "$ROOT_DIR/tests/helpers/tab_source.js" servers --decl getRuleEditButtonText)"
[ -n "$edit_label_definition" ] ||
  fail "the shared CBI layer must own the row action label helper"
[ "$(printf '%s\n' "$edit_label_definition" | grep -cE "['\"]Edit rule action['\"]")" = "2" ] ||
  fail "the row action label must compare the translation against its own msgid"
if grep -Fq 'function getRuleEditButtonText' "$FORKOP_JS"; then
  fail "the row action label must not be defined a second time for the page"
fi
grep -Fq 'getRuleEditButtonText()' "$FORKOP_JS" ||
  fail "the Sections grid must take the row action label from the shared helper"

awk '
  $0 == "msgid \"Edit rule action\"" {
    getline
    if ($0 == "msgstr \"Изменить\"")
      found = 1
  }
  END { exit found ? 0 : 1 }
' "$PO" || fail "the row action label must stay the short Изменить"

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

# A catalog entry for a string no source asks for any more is dead weight nobody
# notices, and a string with no entry falls back to English in the interface. Both
# directions are compared against every _() call the two front ends make.
node - "$ROOT_DIR" "$PO" "$POT" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [, , root, poPath, potPath] = process.argv;

function unescapePo(value) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function msgids(text) {
  const ids = [];
  const entryRe = new RegExp('^msgid ((?:"(?:\\\\.|[^"\\\\])*"\\s*)+)', "gm");
  const partRe = new RegExp('"((?:\\\\.|[^"\\\\])*)"', "g");
  for (const entry of text.matchAll(entryRe)) {
    const joined = [...entry[1].matchAll(partRe)].map((part) => part[1]).join("");
    if (joined) ids.push(unescapePo(joined));
  }
  return ids;
}

function walk(dir, out = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js)$/.test(item.name)) out.push(full);
  }
  return out;
}

const viewDir = path.join(
  root,
  "luci-app-forkop/htdocs/luci-static/resources/view/forkop",
);
// main.js is the generated bundle of the other front end, so it repeats strings
// the sources already declare.
const sources = fs
  .readdirSync(viewDir)
  .filter((name) => name.endsWith(".js") && name !== "main.js")
  .map((name) => fs.readFileSync(path.join(viewDir, name), "utf8"));
const frontend = walk(path.join(root, "fe-app-forkop/src")).map((file) =>
  fs.readFileSync(file, "utf8"),
);

const used = new Set();
const callRe = new RegExp(
  "_\\(\\s*(?:\"((?:\\\\.|[^\"\\\\])*)\"|'((?:\\\\.|[^'\\\\])*)'|`([^`]*)`)",
  "g",
);
for (const match of [...sources, ...frontend].join("\n").matchAll(callRe)) {
  used.add(unescapePo(match[1] ?? match[2] ?? match[3]).replace(/\\'/g, "'"));
}

let failed = false;
for (const [label, file] of [["ru catalog", poPath], ["template", potPath]]) {
  const ids = msgids(fs.readFileSync(file, "utf8"));
  const orphaned = ids.filter((id) => !used.has(id));
  const absent = [...used].filter((id) => !ids.includes(id));
  for (const id of orphaned) {
    console.error(`orphaned in ${label}: ${JSON.stringify(id)}`);
    failed = true;
  }
  for (const id of absent) {
    console.error(`missing from ${label}: ${JSON.stringify(id)}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
NODE
[ $? -eq 0 ] || fail "translation catalogs must list exactly the strings the sources use"

printf 'LuCI localization checks passed\n'
