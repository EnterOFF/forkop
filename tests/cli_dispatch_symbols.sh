#!/usr/bin/env bash
# ucode resolves a call only when it runs, so a dispatch branch left behind by a
# removed function stays syntactically valid and fails on the router instead.
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_DIR="$ROOT_DIR/forkop/files/usr/lib"

node - "$LIB_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');

const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'switch', 'try', 'catch', 'return', 'function',
]);

// ucode built-ins the modules call directly
const BUILTINS = new Set([
  'exit', 'print', 'warn', 'printf', 'sprintf', 'length', 'type', 'keys', 'values',
  'push', 'pop', 'shift', 'unshift', 'index', 'rindex', 'substr', 'split', 'join',
  'trim', 'ltrim', 'rtrim', 'match', 'replace', 'int', 'sort', 'reverse', 'uc', 'lc',
  'require', 'json', 'b64dec', 'b64enc', 'chr', 'ord', 'hex', 'min', 'max', 'abs',
  'sourcepath', 'getenv', 'system', 'slice', 'uniq', 'filter', 'map', 'exists',
  'assert', 'die', 'gc', 'clock', 'time', 'localtime', 'gmtime', 'timelocal',
  'timegm', 'sleep', 'regexp', 'wildcard', 'call', 'signal', 'number', 'uchr',
  'hexenc', 'hexdec', 'iptoarr', 'arrtoip', 'sourcefile',
]);

function ucodeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return ucodeFiles(full);
    return entry.isFile() && entry.name.endsWith('.uc') ? [full] : [];
  });
}

const problems = [];

for (const file of ucodeFiles(process.argv[2]).sort()) {
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split('\n');
  const start = lines.findIndex((line) => /^let mode = ARGV/.test(line));
  if (start < 0) continue;

  const defined = new Set();
  for (const pattern of [
    /^function ([A-Za-z_][\w]*)\(/gm,
    /^let ([A-Za-z_][\w]*) = /gm,
    /^const ([A-Za-z_][\w]*) = /gm,
  ]) {
    for (const m of source.matchAll(pattern)) defined.add(m[1]);
  }

  const dispatch = lines.slice(start).join('\n');
  for (const m of dispatch.matchAll(/\blet ([A-Za-z_][\w]*) =/g)) defined.add(m[1]);

  for (const m of dispatch.matchAll(/\b([A-Za-z_][\w]*)\s*\(/g)) {
    const name = m[1];
    if (KEYWORDS.has(name) || BUILTINS.has(name) || defined.has(name)) continue;
    if (dispatch.slice(0, m.index).trimEnd().endsWith('.')) continue;
    const line = start + dispatch.slice(0, m.index).split('\n').length;
    problems.push(`${path.relative(process.argv[2], file)}:${line} calls undefined ${name}()`);
  }
}

if (problems.length) {
  console.error('FAIL: command dispatch calls names the module does not define');
  problems.forEach((problem) => console.error(`  ${problem}`));
  process.exit(1);
}
NODE

printf 'CLI dispatch symbol checks passed\n'
