#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIEW_DIR="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

# The editor analyses a DPI strategy locally so it can annotate it while it is
# typed, and diagnostics/runtime.uc validates the same value through the
# provider validators on save. The local answer runs first and can refuse a
# value on its own, so a strategy the backend accepts has to pass the editor and
# a strategy the backend refuses has to fail it.
CASES="$WORK_DIR/cases.json"
cat >"$CASES" <<'JSON'
{
  "nfqws": [
    "--dpi-desync=fake,fakedsplit --dpi-desync-autottl=2",
    "--filter-tcp=80 --dpi-desync=fake --dpi-desync-repeats=11",
    "--dpi-desync=fake --dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com",
    "--hostcase --domcase --methodeol",
    "--debug --comment=note",
    "--wssize 1:6",
    "--dpi-desync=fake --hostlist=/opt/zapret/ipset/list.txt",
    "--qnum=200 --dpi-desync=fake",
    "--dpi-desync-fwmark=0x40000000",
    "--daemon --dpi-desync=fake",
    "--dry-run",
    "--version",
    "--ipset=/opt/zapret/ipset/list.txt",
    "--nonsense-flag",
    "--dpi-desync=fake extra-token",
    "--hostcase=1",
    "@/etc/zapret/config"
  ],
  "nfqws2": [
    "--filter-tcp=443 --filter-l7=tls --payload=tls_client_hello",
    "--lua-desync=fake:blob=fake_default_tls --new",
    "--filter-ssid=home",
    "--filter-icmp=1",
    "--filter-ipp=6",
    "--debug --comment=note",
    "--dry-run",
    "--daemon",
    "--fuzz=1",
    "--intercept=0",
    "--fwmark=0x40000000",
    "--qnum=200",
    "--hostlist-auto-udp-in=1",
    "--hostlist-auto-retrans-maxseq=3",
    "--ipset=/tmp/list.txt",
    "--nonsense-flag",
    "--dpi-desync=fake"
  ],
  "byedpi": [
    "-o 2 --auto=t,r,a,s -d 2",
    "--split 1 --disorder 2",
    "-K -T 3",
    "--md5sig --tfo",
    "--ip 127.0.0.1",
    "-i 127.0.0.1",
    "--port 1080",
    "-p 1080",
    "--transparent",
    "-E",
    "--daemon",
    "-D",
    "--pidfile /tmp/x.pid",
    "-w /tmp/x.pid",
    "--help",
    "-h",
    "--version",
    "-v",
    "--nonsense-flag"
  ]
}
JSON

# The backend verdict for the same values, through the shipped validators.
cat >"$WORK_DIR/backend.uc" <<'UC'
let nfqueue = require("providers.nfqueue.validator");
let byedpi = require("providers.byedpi.validator");
let fs = require("fs");

let cases = json(fs.readfile(ARGV[0]));
let result = { nfqws: [], nfqws2: [], byedpi: [] };

for (let value in cases.nfqws)
    push(result.nfqws, nfqueue.validate_expected_strategy("nfqws", "nfqws", value, "").valid === true);
for (let value in cases.nfqws2)
    push(result.nfqws2, nfqueue.validate_expected_strategy("nfqws2", "nfqws2", value, "").valid === true);
for (let value in cases.byedpi)
    push(result.byedpi, byedpi.validate_byedpi_strategy(value).valid === true);

print(sprintf("%J", result), "\n");
UC

BACKEND_JSON="$(ucode -L "$FORKOP_LIB" "$WORK_DIR/backend.uc" -- "$CASES")" ||
  fail "backend validators could not be driven"

VIEW_DIR="$VIEW_DIR" CASES="$CASES" BACKEND_JSON="$BACKEND_JSON" node - <<'NODE'
const fs = require('fs');
const path = require('path');

// LuCI installs a printf-like String.prototype.format that the view code uses
// for its messages. Only %s and %d appear in the strategy analyzers.
if (!String.prototype.format) {
  // eslint-disable-next-line no-extend-native
  String.prototype.format = function format(...args) {
    let index = 0;
    return this.replace(/%[sd]/g, () => `${args[index++]}`);
  };
}

// Loads a LuCI view module: the "require x" preamble strings are directives for
// the LuCI loader rather than statements, so the dependencies are resolved here
// and the body is evaluated with the same globals LuCI provides.
const loaded = new Map();
function loadModule(name) {
  if (loaded.has(name)) return loaded.get(name);
  const file = path.join(process.env.VIEW_DIR, `${name}.js`);
  const source = fs.readFileSync(file, 'utf8');
  const deps = [];
  for (const line of source.split('\n')) {
    const matched = /^"require ([\w.]+)(?: as (\w+))?";$/.exec(line.trim());
    if (matched) deps.push([matched[1], matched[2]]);
    if (!/^"/.test(line.trim()) && line.trim()) break;
  }

  const args = ['_', 'baseclass'];
  const values = [(text) => text, { extend: (value) => value }];
  for (const [dep, alias] of deps) {
    if (dep === 'baseclass') continue;
    const local = alias || dep.split('.').pop();
    args.push(local);
    values.push(loadModule(dep.replace(/^view\.forkop\./, '')));
  }

  const body = source
    .split('\n')
    .filter((line) => !/^"require [\w.]+(?: as \w+)?";$/.test(line.trim()))
    .join('\n');
  // eslint-disable-next-line no-new-func
  const module = new Function(...args, body)(...values);
  loaded.set(name, module);
  return module;
}

const dpi = loadModule('dpi_strategy');
const cases = JSON.parse(fs.readFileSync(process.env.CASES, 'utf8'));
const backend = JSON.parse(process.env.BACKEND_JSON);

const problems = [];

function check(kind, analyze) {
  cases[kind].forEach((value, index) => {
    const analysis = analyze(value);
    const editorValid = analysis.valid === true;
    const backendValid = backend[kind][index] === true;
    if (editorValid !== backendValid) {
      problems.push(
        `${kind} ${JSON.stringify(value)}: editor says ${
          editorValid ? 'valid' : 'invalid'
        }, backend says ${backendValid ? 'valid' : 'invalid'}` +
          (analysis.message ? ` (${analysis.message})` : ''),
      );
    }
    if (!editorValid && !analysis.message) {
      problems.push(`${kind} ${JSON.stringify(value)}: refused without a message`);
    }
    if (!editorValid && value.trim() && !analysis.annotations.length) {
      problems.push(
        `${kind} ${JSON.stringify(value)}: refused without marking a token`,
      );
    }
  });
}

check('nfqws', (value) => dpi.buildNfqwsLocalAnalysis(value));
check('nfqws2', (value) => dpi.buildNfqws2LocalAnalysis(value));
check('byedpi', (value) => dpi.buildByedpiLocalAnalysis(value));

// An empty field is the one place the two answers differ on purpose: the editor
// insists on an explicit strategy, while the backend treats an empty option as
// "use the shipped default" and accepts it.
for (const [kind, analyze] of [
  ['nfqws', dpi.buildNfqwsLocalAnalysis],
  ['nfqws2', dpi.buildNfqws2LocalAnalysis],
  ['byedpi', dpi.buildByedpiLocalAnalysis],
]) {
  const analysis = analyze('');
  if (analysis.valid !== false || !analysis.message) {
    problems.push(`${kind}: the editor must refuse an empty strategy with a message`);
  }
}

// The editor rewrites the stored value before it is saved, so normalisation has
// to be stable and must not turn a valid strategy into a different one.
for (const [normalize, value] of [
  [dpi.normalizeNfqwsStrategyValue, '  --dpi-desync=fake   --new  '],
  [dpi.normalizeNfqws2StrategyValue, '  --filter-tcp=443   --new  '],
  [dpi.normalizeByedpiStrategyValue, '  -o 2   --auto=t  '],
]) {
  const once = normalize(value);
  if (normalize(once) !== once) {
    problems.push(`normalisation of ${JSON.stringify(value)} is not stable`);
  }
}

if (problems.length) {
  console.error(`FAIL: ${problems.join('\nFAIL: ')}`);
  process.exit(1);
}
NODE

printf 'DPI strategy editor checks passed\n'
