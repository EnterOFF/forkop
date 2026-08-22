#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIEW_DIR="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop"

node - "$VIEW_DIR/forkop.js" "$VIEW_DIR/section.js" "$VIEW_DIR/server.js" <<'NODE'
const fs = require("fs");
const assert = require("assert");

const views = [
  ["forkop.js", fs.readFileSync(process.argv[2], "utf8")],
  ["section.js", fs.readFileSync(process.argv[3], "utf8")],
  ["server.js", fs.readFileSync(process.argv[4], "utf8")],
];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// The helper is duplicated on purpose: a name imported across two LuCI views is
// undefined in a browser that cached one of them before an app upgrade. What holds
// the copies together is this check, not the import.
function helperSource(source, file) {
  const start = source.indexOf("const SECTION_ID_PREFIXES = {");
  if (start === -1) {
    fail(`${file} must carry the section id helper`);
  }
  const body = source.indexOf("function nextSectionId(", start);
  if (body === -1) {
    fail(`${file} must define nextSectionId next to the prefix table`);
  }
  const end = source.indexOf("\n}\n", body);
  if (end === -1) {
    fail(`${file}: nextSectionId never ends`);
  }
  return source.slice(start, end + "\n}\n".length);
}

const [[, entrySource]] = views;
const helper = helperSource(entrySource, "forkop.js");
for (const [file, source] of views.slice(1)) {
  if (helperSource(source, file) !== helper) {
    fail(`the section id helper in ${file} must be the same text as in forkop.js`);
  }
}

// LuCI's placeholder id and the prefixes that outlived the type they named.
for (const [file, source] of views) {
  for (const stale of [".createSID(", "`pg_", "`tun_", "`tp_"]) {
    if (source.includes(stale)) {
      fail(`${file} must not name a section with ${stale}`);
    }
  }
}

// Every type in the table is a type one of the views creates, and every type a view
// creates gets an id: an anonymous section can only be addressed as @type[index],
// which libuci numbers by position across the whole file.
const table = helper.slice(
  helper.indexOf("{") + 1,
  helper.indexOf("};"),
);
const prefixes = new Map(
  Array.from(table.matchAll(/^\s*([a-z_]+): "([a-z_]+)",$/gm), (match) => [
    match[1],
    match[2],
  ]),
);
assert.deepStrictEqual(
  Object.fromEntries(prefixes),
  {
    fallback_group: "group",
    fallback_level: "level",
    section: "section",
    section_interface: "iface",
    server: "server",
    server_client: "client",
    subscription_url: "sub",
    tunnel: "tunnel",
    tunnel_peer: "peer",
    urltest: "urltest",
  },
  "unexpected section id prefix table",
);

const CHILD_TYPE_ALIASES = { CLIENT_TYPE: "server_client" };
for (const [file, source] of views) {
  const declared = Array.from(
    source.matchAll(/\bchildType = (?:"([a-z_]+)"|([A-Z_]+));/g),
    (match) => match[1] || CHILD_TYPE_ALIASES[match[2]] || match[2],
  );
  const named = new Set(
    Array.from(
      source.matchAll(/nextSectionId\((?:"([a-z_]+)"|([A-Z_]+))\)/g),
      (match) => match[1] || CHILD_TYPE_ALIASES[match[2]] || match[2],
    ),
  );
  for (const typeName of declared) {
    if (!named.has(typeName)) {
      fail(`${file} creates ${typeName} sections without an id`);
    }
    if (!prefixes.has(typeName)) {
      fail(`${typeName} has no entry in the section id prefix table`);
    }
  }
}

const UCI_PACKAGE = "forkop";
const stored = new Set();
const uci = {
  get(packageName, sectionId) {
    assert.strictEqual(packageName, UCI_PACKAGE);
    return stored.has(sectionId) ? { ".name": sectionId } : null;
  },
};

// The suffix comes from Math.random(), so the candidates a call gets to try are
// queued as the hex digits they have to produce.
const realRandom = Math.random;
const queued = [];
Math.random = () => (queued.length ? queued.shift() : realRandom());
function queue(...values) {
  values.forEach((value) => queued.push(parseInt(value, 16) / 0x1000000));
}

// const declarations in an eval stay inside it, so the helper is evaluated as a body
// that hands back the function together with the state it closes over.
const nextSectionId = eval(`(() => {\n${helper}\nreturn nextSectionId;\n})()`);

// Every type names itself, and the suffix is six hex digits however small it is.
for (const [typeName, prefix] of prefixes) {
  queue("0a1b2c");
  assert.strictEqual(nextSectionId(typeName), `${prefix}_0a1b2c`);
}
queue("000abc");
assert.strictEqual(nextSectionId("section"), "section_000abc");

// A type the table does not know about is still readable.
queue("0eeeee");
assert.strictEqual(nextSectionId("priority_group"), "priority_group_0eeeee");

// A name a stored section already carries is skipped.
stored.add("server_0aaaaa");
queue("0aaaaa", "0bbbbb");
assert.strictEqual(nextSectionId("server"), "server_0bbbbb");

// So is one already handed out in this dialog: a staged child reaches uci only when
// its parent is saved, so uci.get() cannot see it yet.
queue("0ccccc");
assert.strictEqual(nextSectionId("tunnel_peer"), "peer_0ccccc");
queue("0ccccc", "0ddddd");
assert.strictEqual(nextSectionId("tunnel_peer"), "peer_0ddddd");

Math.random = realRandom;
const generated = nextSectionId("server_client");
assert.match(generated, /^client_[0-9a-f]{6}$/, "unexpected id shape");
assert.match(generated, /^[A-Za-z0-9_]+$/, "a section id must be a valid uci name");

console.log("LuCI section id checks passed");
NODE
