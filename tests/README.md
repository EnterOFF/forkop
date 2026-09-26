# tests

The checks that run in a shell, over the ucode backend and the package.

Everything about the LuCI page lives with the page, in
`fe-app-forkop/tests` and `fe-app-forkop/src/**/tests`, and runs under vitest —
see [Where a check belongs](#where-a-check-belongs).

## Running them

```sh
sandbox/scripts/run-tests.sh            # everything, failures only
sandbox/scripts/run-tests.sh config/    # one subject directory
sandbox/scripts/run-tests.sh urltest    # anything whose path matches
```

Under WSL, not Git Bash: Git Bash has no `ucode`, and a test that cannot start
the interpreter fails with a plausible-looking assertion instead of an error.

CI runs the same set as

```sh
find tests -name '*.sh' -not -path 'tests/lib/*' -not -path 'tests/unit/*' -print0 | sort -z | xargs -0 -n1 -P4 bash
```

## Layout

| Directory   | What it covers |
| ----------- | -------------- |
| `config/`   | Building and validating the sing-box configuration: outbounds, groups, DNS rules, subscriptions, inbound servers, migration. |
| `firewall/` | nftables rules, DNS interception, packet marks. |
| `service/`  | init.d and procd lifecycle, runtime state, diagnostics. |
| `updates/`  | Component version checks and the updater job. |
| `packaging/`| The `.ipk` contract, versions, the release workflow, the bytecode cache. |
| `sources/`  | Checks over the ucode sources themselves: who owns which constant, declaration order, dispatch tables, logging conventions. |
| `unit/`     | ucode unit tests that require a module and call it: `*.test.uc`, laid out like `usr/lib`. |
| `lib/`      | What the shell tests source and require. Not tests. |
| `fixtures/` | Data the tests read. |

## Unit tests

`tests/unit/run.sh [filter]` runs every `tests/unit/**/*.test.uc` in its own
interpreter with `-L tests/unit/fakes -L tests/unit/lib -L forkop/files/usr/lib`.
The fakes stand in for the `uci`, `ubus` and `uloop` modules, so the suite runs on
any ucode build, including CI's, which has none of them.

```ucode
let t = require("t");          // test(), eq(), ok(), contains(), throws(), done()
let stub = require("stub");    // commands(), env(), capture(), tmpdir(), restore()
let uci = require("uci");      // __seed(), __sections(), __commits(), __reset()

t.test("what it protects", () => {
    uci.__seed("forkop", [ { ".name": "settings", ".type": "settings", log_level: "warn" } ]);
    stub.commands([ [ "nft list tables", { status: 0, stdout: "" } ] ]);
    // require the module, call it, assert on what it returned and ran
    stub.restore();
});

t.done();
```

`stub.commands()` replaces `system()` and `fs.popen()` for the test: a command no
handler claims fails the test instead of being answered by default.

## Writing a shell test

Three lines of preamble, and everything else is the check:

```sh
#!/usr/bin/env bash
set -eo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
```

`lib/common.sh` gives you `ROOT_DIR`, `FORKOP_FILES`, `FORKOP_BIN`,
`FORKOP_LIB`, `TESTS_DIR`, a `WORK_DIR` that is removed on exit, and `fail`.
`set -eo pipefail` stays in the test rather than moving into the library, so a
source that fails aborts instead of running the rest of the file with every
check disabled.

A test ends by saying what it checked:

```sh
printf 'urltest group checks passed\n'
```

Two traps this suite has been caught by:

- **`ucode … | grep -q` fails even on a match** under `set -o pipefail`: `grep -q`
  exits at the first line and `ucode` dies of SIGPIPE. Capture the output into a
  variable and match against that.
- **A check that cannot fail reads as coverage.** When a rule is about a region
  of a file, assert that the region was found before asserting anything about
  it — an extraction that silently comes back empty agrees with every
  expectation.

## Where a check belongs

The two suites are split by what the check needs to run, because that decides
which CI job can run it at all.

Here, in a shell, if it needs `ucode`, the installed package tree, or the shipped
shell scripts — including a cross-layer check that compares a table in the
backend with the copy the frontend carries, since only this side can evaluate the
ucode half.

In `fe-app-forkop` otherwise. A check about one module imports it and calls it,
next to the module under `src/**/tests`. A check about the page as a whole goes in
`fe-app-forkop/tests`: `bundle/` for the ones that load the built
`luci-app-forkop/…/main.js` the way the router does, `source/` for the ones that
read the TypeScript as text because what they are about is not reachable as a
call.
