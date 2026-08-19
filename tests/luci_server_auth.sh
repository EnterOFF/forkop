#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIEW_DIR="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop"

node - "$VIEW_DIR" <<'NODE'
const fs = require("fs");
const path = require("path");
const viewDir = process.argv[2];
const read = (name) => fs.readFileSync(path.join(viewDir, name), "utf8");
const source = read("server.js");
const specSource = read("server_spec.js");
const linkSource = read("server_link.js");
const clientsSource = read("server_clients.js");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function requiredIndex(haystack, needle, from = 0) {
  const index = haystack.indexOf(needle, from);
  if (index < 0) fail(`missing source contract: ${needle}`);
  return index;
}

// The mixed inbound is the only server protocol that may run without accounts, and
// the switch that allows it is named in the spec so every layer reads one truth.
const mixedBlock = specSource.slice(requiredIndex(specSource, 'id: "mixed"'));
if (!mixedBlock.slice(0, mixedBlock.indexOf("credentials:")).includes('optionalAuth: "mixed_auth_enabled"')) {
  fail("the mixed inbound must declare its optional authentication switch in the spec");
}
if (specSource.includes("optionalAuth") === false) {
  fail("optional authentication must be expressed in the protocol spec");
}
if ((specSource.match(/optionalAuth:/g) || []).length !== 1) {
  fail("only the mixed inbound may run without authentication");
}

const flagBlock = source.slice(
  requiredIndex(source, '"mixed_auth_enabled"'),
  requiredIndex(source, '"_clients"'),
);
if (!flagBlock.includes('_("Require authentication")') ||
    !flagBlock.includes('o.default = "1"') ||
    !flagBlock.includes('o.depends("protocol", "mixed")')) {
  fail("mixed authentication must be enabled by default and limited to mixed servers");
}

// With authentication off the inbound takes no users, so the editor hides the
// password, the validator skips it and the link carries no credentials.
if (!source.includes('field !== "password" || spec.isAuthenticationEnabled(sectionId)')) {
  fail("the client editor must hide the password while authentication is disabled");
}
if (!clientsSource.includes("validateClientField") ||
    !linkSource.includes('!spec.isAuthenticationEnabled(sectionId)')) {
  fail("credential checks must skip the password while authentication is disabled");
}

const mixedLinks = linkSource.slice(
  requiredIndex(linkSource, "function buildMixedLinks"),
  requiredIndex(linkSource, "function buildHysteria2Link"),
);
if (!mixedLinks.includes("spec.isAuthenticationEnabled(sectionId)")) {
  fail("mixed share links must omit credentials when authentication is disabled");
}
// One listener answers both schemes, so both links are offered.
for (const scheme of ['shareUrl("socks5"', 'shareUrl("http"']) {
  if (!mixedLinks.includes(scheme)) {
    fail(`mixed servers must publish a ${scheme} link`);
  }
}

NODE

printf 'LuCI mixed server authentication checks passed\n'
