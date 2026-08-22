#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# The DPI strategy editor annotates a strategy while it is typed, so it carries its
# own copy of what nfqws, nfqws2 and ByeDPI accept, and of the options Forkop refuses
# because it owns that decision itself. providers/nfqueue/validator.uc and
# providers/byedpi/validator.uc own the same knowledge and have the final word on
# save. When a copy drifts the editor either refuses a strategy the backend accepts -
# and the local check runs first, so the user cannot save at all - or accepts one the
# backend refuses only after the round trip.
#
# Both are asked the same questions here instead of having their tables compared as
# text. Every option-shaped string either side spells out is collected, each one is
# put to both validators in the forms that tell an argument shape apart - bare, with
# an attached value, with a separate one - and the verdicts have to match. That makes
# the check indifferent to how the tables are written, to which of them holds a name,
# and to whether a refusal is a table entry or a special case, while covering both
# directions of the drift.
#
# A refusal also has to stay a refusal for the same reason on both sides: an option
# Forkop turns down on purpose is explained while it is typed, and an option nobody
# recognises is not. Neither wording is spelled out here - each side is asked what it
# says about an option that certainly does not exist, and that answer is what
# "unrecognised" means for that side.
ROOT_DIR="$ROOT_DIR" WORK_DIR="$WORK_DIR" node - <<'NODE'
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = process.env.ROOT_DIR;
const workDir = process.env.WORK_DIR;
const viewDir = path.join(
  root,
  'luci-app-forkop/htdocs/luci-static/resources/view/forkop',
);
const libDir = path.join(root, 'forkop/files/usr/lib');

const { createLoader } = require(
  path.join(root, 'tests/helpers/luci_module.js'),
);
const { readStringLiterals } = require(
  path.join(root, 'tests/helpers/source_literal.js'),
);

const SOURCES = [
  path.join(libDir, 'providers/nfqueue/validator.uc'),
  path.join(libDir, 'providers/byedpi/validator.uc'),
  path.join(viewDir, 'dpi_strategy.js'),
];

// A long flag, a short one, or one of the hostlist templates zapret expands. The
// scrape is deliberately greedy: a name that turns out to belong to no engine is
// one more question both sides answer the same way, while a name left out is a
// question nobody asks. Splitting on whitespace is what turns the default
// strategies - whole command lines in one string - into their options as well.
const OPTION = /^(?:--[a-z][a-z0-9-]*(?:=.*)?|-[A-Za-z][A-Za-z0-9]*|<[A-Z_]+>)$/;

// Two options no engine can have, which is how each side is asked what it says
// about something it does not recognise.
const UNKNOWN_LONG = '--forkop-contract-probe';
const UNKNOWN_SHORT = '-Z';

const universe = new Set();
for (const file of SOURCES) {
  for (const literal of readStringLiterals(fs.readFileSync(file, 'utf8'))) {
    for (const token of literal.split(/\s+/)) {
      if (!OPTION.test(token)) continue;
      universe.add(token);
      const equals = token.indexOf('=');
      if (equals > 0) universe.add(token.slice(0, equals));
    }
  }
}

const problems = [];

// A broken scrape must not look like agreement, so the questions themselves are
// checked before the answers are compared.
for (const anchor of ['--dpi-desync', '--new', '--hostlist', '-s', '--auto']) {
  if (!universe.has(anchor)) {
    problems.push(
      `the option scrape missed ${anchor}, so it is not comparing the tables`,
    );
  }
}
if (universe.size < 100) {
  problems.push(
    `the option scrape found only ${universe.size} options, which cannot be the tables`,
  );
}
for (const reserved of [UNKNOWN_LONG, UNKNOWN_SHORT]) {
  if (universe.has(reserved)) {
    problems.push(
      `${reserved} is now a real option, so it cannot stand for an unknown one`,
    );
  }
}

// Bare, with a value attached, and with a value in the next token. A flag, an
// option with an optional value and an option that requires one answer these three
// differently, so the triple names the argument shape without reading a message.
function probeForms(token) {
  if (token.includes('=') || !token.startsWith('-')) {
    return [token];
  }
  if (token.startsWith('--')) {
    return [token, `${token}=1`, `${token} 1`];
  }
  return token.length === 2 ? [token, `${token}5`, `${token} 5`] : [token];
}

const SHAPES = {
  'yes,yes,no': 'taking an optional attached value',
  'yes,no,no': 'taking no value',
  'no,yes,yes': 'requiring a value',
  'no,no,no': 'refused or unknown',
};

function shape(verdicts) {
  const key = verdicts.map((valid) => (valid ? 'yes' : 'no')).join(',');
  if (SHAPES[key]) return SHAPES[key];
  if (verdicts.length === 1) return verdicts[0] ? 'accepted' : 'refused';
  return `an unusual shape (${key})`;
}

const dpi = createLoader(viewDir)('dpi_strategy');
const EDITOR = {
  nfqws: (value) => dpi.buildNfqwsLocalAnalysis(value),
  nfqws2: (value) => dpi.buildNfqws2LocalAnalysis(value),
  byedpi: (value) => dpi.buildByedpiLocalAnalysis(value),
};
const KINDS = Object.keys(EDITOR);

// Every option is put to every engine. A name that belongs to another one is still
// a fair question - both sides have to refuse it - and asking it is how an nfqws2
// option that leaked into the nfqws table gets noticed.
const questions = [];
for (const kind of KINDS) {
  for (const token of [...universe].sort()) {
    questions.push({ kind, token, forms: probeForms(token) });
  }
}

// The unknown-option answers come first so that both sides have a baseline before
// any real option is classified.
const probes = [];
for (const kind of KINDS) {
  probes.push({ kind, value: UNKNOWN_LONG }, { kind, value: UNKNOWN_SHORT });
}
for (const question of questions) {
  for (const value of question.forms) {
    probes.push({ kind: question.kind, value });
  }
}

const probeFile = path.join(workDir, 'probes.json');
fs.writeFileSync(probeFile, JSON.stringify(probes));
const backend = JSON.parse(
  execFileSync(
    'ucode',
    [
      '-L',
      libDir,
      path.join(root, 'tests/helpers/dpi_strategy_probe.uc'),
      probeFile,
    ],
    { encoding: 'utf8' },
  ),
);

if (backend.length !== probes.length) {
  problems.push(
    `the validators answered ${backend.length} of ${probes.length} probes`,
  );
  console.error(`FAIL: ${problems.join('\nFAIL: ')}`);
  process.exit(1);
}

// The same message with the option taken out of it, so that "unknown option --x"
// and "unknown option --y" are one answer.
function withoutToken(message, value) {
  return `${message}`
    .split(value)
    .join('<option>')
    .replace(/\s+/g, ' ')
    .trim();
}

const unrecognised = { editor: {}, backend: {} };
let cursor = 0;
for (const kind of KINDS) {
  unrecognised.editor[kind] = new Set();
  unrecognised.backend[kind] = new Set();

  for (const value of [UNKNOWN_LONG, UNKNOWN_SHORT]) {
    const fromEditor = EDITOR[kind](value);
    const fromBackend = backend[cursor];
    cursor += 1;

    if (fromEditor.valid === true || fromBackend.valid === true) {
      problems.push(
        `${kind} accepts ${value}, so an unknown option cannot be recognised as one`,
      );
      continue;
    }
    unrecognised.editor[kind].add(withoutToken(fromEditor.message, value));
    unrecognised.backend[kind].add(withoutToken(fromBackend.message, value));
  }
}

// Accepted, refused as an option nobody knows, or refused with a reason of its own.
function refusal(result, value, known) {
  if (result.valid === true) return 'accepted';
  return known.has(withoutToken(result.message, value))
    ? 'refused as unknown'
    : 'refused with a reason';
}

for (const question of questions) {
  const editorVerdicts = [];
  const backendVerdicts = [];
  const bare = { editor: null, backend: null };

  question.forms.forEach((value, index) => {
    const fromEditor = EDITOR[question.kind](value);
    const fromBackend = backend[cursor];
    cursor += 1;

    editorVerdicts.push(fromEditor.valid === true);
    backendVerdicts.push(fromBackend.valid === true);

    // Only the bare form, where each side reports exactly one problem: the editor
    // lists every error it found and the backend stops at the first, so a two token
    // probe compares two different amounts of text.
    if (index > 0) return;
    bare.editor = refusal(
      fromEditor,
      value,
      unrecognised.editor[question.kind],
    );
    bare.backend = refusal(
      fromBackend,
      value,
      unrecognised.backend[question.kind],
    );
  });

  if (editorVerdicts.join() !== backendVerdicts.join()) {
    problems.push(
      `${question.kind} ${question.token}: the editor treats it as ` +
        `${shape(editorVerdicts)}, the validator as ${shape(backendVerdicts)}`,
    );
    continue;
  }

  if (bare.editor !== bare.backend) {
    problems.push(
      `${question.kind} ${question.token}: the editor has it ` +
        `${bare.editor}, the validator ${bare.backend}`,
    );
  }
}

if (problems.length) {
  console.error(`FAIL: ${problems.join('\nFAIL: ')}`);
  process.exit(1);
}

process.stdout.write(
  `${universe.size} DPI options agree across the editor and the validators\n`,
);
NODE

printf 'DPI option table checks passed\n'
