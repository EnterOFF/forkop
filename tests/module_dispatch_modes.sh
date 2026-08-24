#!/usr/bin/env bash
# A module invoked with a mode its dispatch does not have fails at runtime, on
# the router, silently: the callers here read the exit status as an answer, so a
# missing mode does not look like an error, it looks like "no". That is how the
# teardown in service/lifecycle.uc came to skip removing the routing rules and
# the routing table it had added - it asked nft/apply.uc for four pass-through
# modes that had been removed, read every failure as "not present", and left the
# kernel state behind on every stop.
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_DIR="$ROOT_DIR/forkop/files/usr/lib"

node - "$LIB_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');

const libDir = process.argv[2];

function ucodeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return ucodeFiles(full);
    return entry.isFile() && entry.name.endsWith('.uc') ? [full] : [];
  });
}

// `const SOMETHING_UC = LIB_DIR + "/service/ui.uc";`
function moduleConstants(source) {
  const constants = new Map();
  const pattern = /const\s+([A-Z0-9_]+)\s*=\s*LIB_DIR\s*\+\s*"(\/[^"]+\.uc)"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    constants.set(match[1], match[2].slice(1));
  }
  return constants;
}

// Every literal the dispatch at the bottom of a module compares its mode against.
function dispatchModes(source) {
  const modes = new Set();
  const pattern = /\b\w*(?:mode|MODE)\s*==\s*"([^"]+)"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    modes.add(match[1]);
  }
  return modes;
}

// `module_success(NFT_UC, [ "tproxy-route4-present", ... ])`
function requestedModes(source) {
  const requests = [];
  const pattern =
    /module_(?:success|status|output|passthrough)\(\s*([A-Z0-9_]+)\s*,\s*\[\s*"([^"]+)"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    requests.push({ constant: match[1], mode: match[2] });
  }
  return requests;
}

const files = ucodeFiles(libDir);
const modesByFile = new Map();
for (const file of files) {
  modesByFile.set(
    path.relative(libDir, file).split(path.sep).join('/'),
    dispatchModes(fs.readFileSync(file, 'utf8')),
  );
}

const problems = [];
let checked = 0;

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const constants = moduleConstants(source);
  const caller = path.relative(libDir, file).split(path.sep).join('/');

  for (const { constant, mode } of requestedModes(source)) {
    const target = constants.get(constant);
    if (!target) continue;

    const known = modesByFile.get(target);
    if (!known) {
      problems.push(`${caller}: ${constant} points at missing ${target}`);
      continue;
    }

    // A shim that hands ARGV to a shared implementation - the DPI providers do
    // this - has no literals of its own, and following that indirection is not
    // worth the guesswork. Such a target is left unchecked rather than reported.
    if (known.size === 0) continue;

    checked += 1;
    if (!known.has(mode)) {
      problems.push(`${caller}: ${target} has no dispatch for "${mode}"`);
    }
  }
}

if (checked === 0) {
  console.error('FAIL: no cross-module dispatch calls were found to check');
  process.exit(1);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`FAIL: ${problem}`);
  process.exit(1);
}

console.log(`module dispatch modes checked: ${checked}`);
NODE

printf 'Module dispatch mode checks passed\n'
