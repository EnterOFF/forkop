#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js"

node - "$SECTION_JS" <<'NODE'
const assert = require('assert');
const source = require('fs').readFileSync(process.argv[2], 'utf8');

const tokenizer = source.match(
  /function parseByedpiStrategyTokens\([\s\S]*?\n}\n/,
);
assert(tokenizer, 'ByeDPI strategy tokenizer not found');
eval(tokenizer[0]);

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

const plain = parseByedpiStrategyTokens('--disorder 3  --fake-sni example.org');
assert.deepStrictEqual(
  plain.tokens.map((token) => token.value),
  ['--disorder', '3', '--fake-sni', 'example.org'],
  'unquoted strategies must tokenize on whitespace as before',
);

assert.strictEqual(
  parseByedpiStrategyTokens('-H:"one.example').unterminatedQuote,
  '"',
  'an unterminated quote must be reported instead of guessed',
);

const analysis = source.match(
  /function buildByedpiLocalAnalysis\([\s\S]*?\nfunction analyzeByedpiStrategy\(/,
);
assert(analysis, 'ByeDPI local analysis not found');
assert.match(
  analysis[0],
  /parseByedpiStrategyTokens\(text\)/,
  'ByeDPI analysis must use the quote-aware tokenizer',
);
assert.match(
  analysis[0],
  /unterminated %s quote/,
  'ByeDPI analysis must explain an unterminated quote',
);
NODE

printf 'LuCI ByeDPI strategy checks passed\n'
