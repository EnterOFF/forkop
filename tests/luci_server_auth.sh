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
// Both path fields read the same whatever the listener speaks, so nothing rewrites a
// description per protocol any more.
if (source.includes("describePerProtocol")) {
  fail("the per-protocol certificate description branch must be gone");
}

// A NaiveProxy client verifies the certificate the way a browser does, so the
// self-signed one Forkop issues is refused and the button that issues it is not
// offered there. The two path fields stay, for a certificate of your own.
const certificateRule = source.slice(
  requiredIndex("function offersCertificateButton"),
  requiredIndex("function syncCertificateButton"),
);
if (!certificateRule.includes('protocol !== "naive"')) {
  fail("NaiveProxy must be the listener the certificate button is withheld from");
}
const certificateButton = source.slice(
  requiredIndex("function addCertificateButton"),
  requiredIndex("function addSshHostKeyButton"),
);
if (!certificateButton.includes("offersCertificateButton")) {
  fail("the certificate button must follow that rule");
}

// And it has to follow a protocol change, not only the protocol the dialog was built
// with: LuCI renders every option once and a later change only shows and hides them,
// so a server that started as Mixed kept a button an existing NaiveProxy server never
// had.
const protocolChange = source.slice(
  requiredIndex("o.onchange = function (_ev, sectionId, value) {"),
);
if (!protocolChange.slice(0, 400).includes("syncCertificateButton(sectionId, value)")) {
  fail("changing the protocol must show or hide the certificate button");
}
const issueButton = source.slice(
  requiredIndex("function addIssueButton"),
  requiredIndex("function issueRequest"),
);
if (!issueButton.includes("showIssueButton(row, offered(getProtocol(sectionId)))")) {
  fail("addIssueButton must set the visibility of its button when it builds the row");
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
