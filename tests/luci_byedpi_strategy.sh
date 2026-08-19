#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIEW_DIR="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop"
SECTION_JS="$VIEW_DIR/section.js"
LOADER="$ROOT_DIR/tests/helpers/luci_module.js"

VIEW_DIR="$VIEW_DIR" LOADER="$LOADER" SECTION_JS="$SECTION_JS" node - <<'NODE'
const assert = require('assert');
const fs = require('fs');
const { createLoader } = require(process.env.LOADER);

const dpi = createLoader(process.env.VIEW_DIR)('dpi_strategy');
const { parseByedpiStrategyTokens } = dpi;

const quoted = parseByedpiStrategyTokens('-H:"one.example two.example" -N');
assert.strictEqual(quoted.unterminatedQuote, '');
assert.deepStrictEqual(
  quoted.tokens.map((token) => token.value),
  ['-H:one.example two.example', '-N'],
  'quotes must group one ciadpi argument and disappear from it',
);
assert.strictEqual(quoted.tokens[0].start, 0);
assert.strictEqual(
  quoted.tokens[0].end,
  '-H:"one.example two.example"'.length,
  'annotation offsets must cover the quoted span of the original text',
);

assert.deepStrictEqual(
  parseByedpiStrategyTokens('--disorder 3 --fake-sni example.org').tokens.map(
    (token) => token.value,
  ),
  ['--disorder', '3', '--fake-sni', 'example.org'],
  'unquoted strategies must tokenize on whitespace as before',
);

assert.strictEqual(
  parseByedpiStrategyTokens('-H:"one.example').unterminatedQuote,
  '"',
  'an unterminated quote must be reported instead of guessed',
);

// The local analysis has to use the quote-aware tokenizer, otherwise a quoted
// host list is annotated at the wrong offsets.
const unterminated = dpi.buildByedpiLocalAnalysis('-H:"one.example');
assert.strictEqual(unterminated.valid, false);
assert.match(
  unterminated.message,
  /unterminated . quote/i,
  'ByeDPI analysis must explain an unterminated quote',
);

const quotedAnalysis = dpi.buildByedpiLocalAnalysis(
  '-H:"one.example two.example" -N',
);
assert.strictEqual(
  quotedAnalysis.valid,
  true,
  'a quoted ciadpi argument must stay valid',
);

// The backend matches its needle against quote-stripped argv, so the analyzer
// that renders a backend rejection has to tokenize the same way the local one
// does - not on plain whitespace.
const wiring = fs
  .readFileSync(process.env.SECTION_JS, 'utf8')
  .match(/const analyzeByedpiStrategy = createStrategyAnalyzer\([\s\S]*?\);/);
assert(wiring, 'ByeDPI analyzer wiring not found');
assert.match(
  wiring[0],
  /parseByedpiStrategyTokens\(text\)\.tokens/,
  'ByeDPI backend annotations must use the quote-aware tokenizer',
);
NODE

printf 'LuCI ByeDPI strategy checks passed\n'
