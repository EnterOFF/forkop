#!/usr/bin/env bash
# A LuCI view is one big function the browser evaluates, so a name that no longer
# exists is not a load error - it throws the first time the line runs. That is how a
# removed helper survived in two save handlers: every attempt to save a section threw
# ReferenceError inside handleModalSave, which is a synchronous throw, so the Save
# button spun forever and nothing said why.
#
# ESLint answers the question the browser answers too late: which identifiers a file
# reads and never defines. The globals a view gets are its own - the require prologue
# names them - plus the ones LuCI and the browser provide.
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIEW_DIR="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop"
ESLINT="$ROOT_DIR/fe-app-forkop/node_modules/.bin/eslint"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

if [ ! -x "$ESLINT" ] && [ ! -f "$ESLINT" ]; then
  printf 'note: eslint is not installed, view name resolution was not checked\n'
  exit 0
fi

# What a LuCI view may reach without declaring it: the page globals, the translation
# helpers LuCI installs, and the element builder.
cat >"$WORK_DIR/globals.json" <<'JSON'
[
  "window", "document", "location", "navigator", "history", "screen",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask",
  "console", "fetch", "URL", "URLSearchParams", "Blob", "File", "FileReader",
  "FormData", "Headers", "Request", "Response", "AbortController", "Event",
  "CustomEvent", "MouseEvent", "KeyboardEvent", "MutationObserver",
  "ResizeObserver", "IntersectionObserver", "TextEncoder", "TextDecoder",
  "WebSocket", "Worker", "getComputedStyle", "matchMedia", "atob", "btoa",
  "HTMLElement", "DecompressionStream", "CompressionStream",
  "escape", "unescape", "alert", "confirm", "prompt", "localStorage",
  "sessionStorage", "crypto", "performance", "structuredClone", "Image",
  "L", "E", "_", "N_", "cbi_update_table", "XHR"
]
JSON

node - "$VIEW_DIR" "$WORK_DIR" <<'NODE'
const fs = require("fs");
const path = require("path");

const [viewDir, workDir] = process.argv.slice(2);
const base = JSON.parse(fs.readFileSync(path.join(workDir, "globals.json"), "utf8"));
const entries = [];

for (const name of fs.readdirSync(viewDir).filter((f) => f.endsWith(".js"))) {
  const source = fs.readFileSync(path.join(viewDir, name), "utf8");
  // The require prologue is what LuCI passes the factory as arguments.
  const injected = [...source.matchAll(/^"require ([A-Za-z0-9_.]+)(?: as ([A-Za-z0-9_]+))?";$/gm)]
    .map((match) => match[2] || match[1]);
  entries.push({
    files: [`luci-app-forkop/htdocs/luci-static/resources/view/forkop/${name}`],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: Object.fromEntries(
        [...base, ...injected].map((global) => [global, "readonly"]),
      ),
    },
    // A view body is a function body, so a bare return at the end is expected.
    linterOptions: { reportUnusedDisableDirectives: false },
    rules: { "no-undef": "error" },
  });
}

fs.writeFileSync(
  path.join(workDir, "eslint.config.mjs"),
  `export default ${JSON.stringify(entries, null, 2)};\n`,
);
NODE

# A view is the body of a function, so its trailing return is wrapped away first.
mkdir -p "$WORK_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop"
for file in "$VIEW_DIR"/*.js; do
  name="$(basename "$file")"
  {
    printf '(function () {\n'
    cat "$file"
    printf '\n});\n'
  } >"$WORK_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/$name"
done

cd "$WORK_DIR"
if ! output="$("$ESLINT" --no-config-lookup -c "$WORK_DIR/eslint.config.mjs" \
  "luci-app-forkop/htdocs/luci-static/resources/view/forkop" 2>&1)"; then
  printf '%s\n' "$output" >&2
  fail "a LuCI view reads a name nothing defines"
fi

printf 'LuCI view name resolution checks passed\n'
