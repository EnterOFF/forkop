#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/server.js"

node - "$SERVER_JS" <<'NODE'
const fs = require("fs");
const source = fs.readFileSync(process.argv[2], "utf8");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function requiredIndex(needle, from = 0) {
  const index = source.indexOf(needle, from);
  if (index < 0) fail(`missing source contract: ${needle}`);
  return index;
}

// The mixed inbound is the only server protocol that may run without accounts, and
// the switch that allows it is named in the protocol table so every layer reads one
// truth.
const mixedBlock = source.slice(requiredIndex('id: "mixed"'));
if (
  !mixedBlock
    .slice(0, mixedBlock.indexOf("credentials:"))
    .includes('optionalAuth: "mixed_auth_enabled"')
) {
  fail("the mixed inbound must declare its optional authentication switch");
}
if ((source.match(/optionalAuth:/g) || []).length !== 1) {
  fail("only the mixed inbound may run without authentication");
}

const flagBlock = source.slice(
  requiredIndex('"mixed_auth_enabled",'),
  requiredIndex("function addClientListOption"),
);
if (
  !flagBlock.includes('_("Authentication")') ||
  !flagBlock.includes('o.default = "1"') ||
  !flagBlock.includes('o.depends("protocol", "mixed")')
) {
  fail("mixed authentication must be on by default and limited to mixed servers");
}

// With authentication off the inbound takes no users, so the client dialog hides the
// password, the checks skip it and the link carries no credentials.
const visibleFields = source.slice(
  requiredIndex("function visibleClientFields"),
  requiredIndex("function clientCredentialLabel"),
);
if (
  !visibleFields.includes('if (field === "password") {') ||
  !visibleFields.includes("return isAuthenticationEnabled(sectionId);")
) {
  fail("the client dialog must hide the password while authentication is disabled");
}
// The certificate Forkop issues is self-signed, and a NaiveProxy client verifies it
// the way a browser does with no way of being told otherwise. Issuing one there
// would only build a server nobody can reach, so the button is not offered and the
// two path fields say what to put in them instead.
const certificateBlock = source.slice(
  requiredIndex("function needsIssuedCertificate"),
  requiredIndex("function addSshHostKeyButton"),
);
if (!certificateBlock.includes('getProtocol(sectionId) !== "naive"')) {
  fail("the certificate button must be withheld from NaiveProxy");
}
if (!certificateBlock.includes("(sectionId) => !needsIssuedCertificate(sectionId)")) {
  fail("addCertificateButton must pass the withheld-button predicate");
}
if ((source.match(/describePerProtocol\(/g) || []).length !== 3) {
  fail("both certificate path fields must describe themselves per protocol");
}

// XTLS Vision needs the raw TLS stream the listener owns, so the flow disappears
// wherever a transport wraps it or a multiplexed client drops it.
if (
  !visibleFields.includes('if (field === "flow") {') ||
  !visibleFields.includes("return supportsVisionFlow(sectionId);")
) {
  fail("the client dialog must hide the flow where Vision cannot be carried");
}
if (
  !source.includes('if (field === "password" && !isAuthenticationEnabled(sectionId))')
) {
  fail("credential checks must skip the password while authentication is disabled");
}

const mixedLinks = source.slice(
  requiredIndex("function buildMixedLinks"),
  requiredIndex("function buildHysteria2Link"),
);
if (!mixedLinks.includes("isAuthenticationEnabled(sectionId)")) {
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
