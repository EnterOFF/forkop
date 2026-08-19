#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NFQUEUE_UC="$ROOT_DIR/forkop/files/usr/lib/providers/nfqueue/validator.uc"
BYEDPI_UC="$ROOT_DIR/forkop/files/usr/lib/providers/byedpi/validator.uc"
SECTION_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js"

# The DPI strategy editor annotates a strategy while it is typed, so it carries
# its own copy of the nfqws, nfqws2 and ByeDPI option tables. The backend
# validators own the same tables and have the final word on save. When a table
# drifts the editor either rejects a strategy the backend accepts - and the
# local check runs first, so the user cannot save at all - or accepts one the
# backend refuses only after the round trip.
NFQUEUE_UC="$NFQUEUE_UC" BYEDPI_UC="$BYEDPI_UC" SECTION_JS="$SECTION_JS" node - <<'NODE'
const fs = require('fs');

const nfqueue = fs.readFileSync(process.env.NFQUEUE_UC, 'utf8');
const byedpi = fs.readFileSync(process.env.BYEDPI_UC, 'utf8');
const section = fs.readFileSync(process.env.SECTION_JS, 'utf8');

const problems = [];

function ucList(source, name, label) {
  const matched = new RegExp(`let ${name} = \\[(.*?)\\];`, 's').exec(source);
  if (!matched) {
    problems.push(`${name} is absent from ${label}`);
    return null;
  }
  return [...matched[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function jsSet(name) {
  const matched = new RegExp(
    `const ${name} = new Set\\(\\[(.*?)\\]\\);`,
    's',
  ).exec(section);
  if (!matched) {
    problems.push(`${name} is absent from section.js`);
    return null;
  }
  return [...matched[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function compare(label, backendList, frontendList) {
  if (!backendList || !frontendList) return;
  const backend = new Set(backendList);
  const frontend = new Set(frontendList);
  const missingInEditor = backendList.filter((item) => !frontend.has(item));
  const missingInBackend = frontendList.filter((item) => !backend.has(item));
  if (missingInEditor.length) {
    problems.push(
      `${label}: the editor does not know ${missingInEditor.join(' ')}, ` +
        'so it refuses a strategy the backend accepts',
    );
  }
  if (missingInBackend.length) {
    problems.push(
      `${label}: the editor accepts ${missingInBackend.join(' ')}, ` +
        'which the backend rejects as an unknown flag',
    );
  }
}

for (const [ucName, jsName] of [
  ['nfqws_optional', 'NFQWS_OPTIONAL_ARG_OPTIONS'],
  ['nfqws_none', 'NFQWS_NO_ARG_OPTIONS'],
  ['nfqws_required', 'NFQWS_REQUIRED_ARG_OPTIONS'],
  ['nfqws2_optional', 'NFQWS2_OPTIONAL_ARG_OPTIONS'],
  ['nfqws2_none', 'NFQWS2_NO_ARG_OPTIONS'],
  ['nfqws2_required', 'NFQWS2_REQUIRED_ARG_OPTIONS'],
]) {
  compare(
    `${ucName}/${jsName}`,
    ucList(nfqueue, ucName, 'providers/nfqueue/validator.uc'),
    jsSet(jsName),
  );
}

for (const [ucName, jsName] of [
  ['long_value_options', 'BYEDPI_LONG_VALUE_OPTIONS'],
  ['long_flag_options', 'BYEDPI_LONG_FLAG_OPTIONS'],
  ['short_value_options', 'BYEDPI_SHORT_VALUE_OPTIONS'],
  ['short_flag_options', 'BYEDPI_SHORT_FLAG_OPTIONS'],
]) {
  compare(
    `${ucName}/${jsName}`,
    ucList(byedpi, ucName, 'providers/byedpi/validator.uc'),
    jsSet(jsName),
  );
}

// The editor also repeats the options Forkop refuses on purpose, so that it can
// explain why while the strategy is typed instead of only after a round trip.
// unsupported_reason() in the backend owns those lists.
const unsupported = /function unsupported_reason\(kind, token\) \{([\s\S]*?)\n\}/.exec(
  nfqueue,
);
if (!unsupported) {
  problems.push(
    'unsupported_reason() is absent from providers/nfqueue/validator.uc',
  );
}

function backendRejected(otherKind) {
  if (!unsupported) return null;
  const rejected = new Set();
  for (const block of unsupported[1].split('if (')) {
    if (block.includes(`kind == "${otherKind}" &&`)) continue;
    for (const item of block.matchAll(/"(--[a-z0-9-]+)"/g)) rejected.add(item[1]);
  }
  return [...rejected];
}

function editorRejected(fnName) {
  const start = section.indexOf(`function ${fnName}(`);
  if (start < 0) {
    problems.push(`${fnName}() is absent from section.js`);
    return null;
  }
  const end = section.indexOf('\n}\n', start);
  const body = end < 0 ? section.slice(start) : section.slice(start, end);
  return [
    ...new Set(
      [...body.matchAll(/token === "(--[a-z0-9-]+)"/g)].map((item) => item[1]),
    ),
  ];
}

for (const [label, backendList, frontendList] of [
  [
    'nfqws refused options',
    backendRejected('nfqws2'),
    editorRejected('getNfqwsForbiddenTokenInfo'),
  ],
  [
    'nfqws2 refused options',
    backendRejected('nfqws'),
    editorRejected('getNfqws2ForbiddenTokenInfo'),
  ],
]) {
  if (!backendList || !frontendList) continue;
  const frontend = new Set(frontendList);
  const missing = backendList.filter((item) => !frontend.has(item));
  if (missing.length) {
    problems.push(
      `${label}: the editor does not explain ${missing.join(' ')}, ` +
        'so the refusal only appears after the backend round trip',
    );
  }
}

if (problems.length) {
  console.error(`FAIL: ${problems.join('\nFAIL: ')}`);
  process.exit(1);
}
NODE

printf 'DPI option table checks passed\n'
