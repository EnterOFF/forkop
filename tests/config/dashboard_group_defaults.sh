#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
CONNECTIONS_UC="$ROOT_DIR/forkop/files/usr/lib/config/connections.uc"
DASHBOARD_TS="$ROOT_DIR/fe-app-forkop/src/forkop/methods/custom/getDashboardSections.ts"

# The group settings a user sees on the dashboard are read twice: config/
# connections.uc feeds them to the sing-box generator, and getDashboardSections.ts
# reads the same UCI options to describe the group in the browser. Nothing joins
# the two, so a default that changes on one side silently makes the dashboard
# describe a configuration sing-box is not running. That already happened once
# with interrupt_exist_connections, which the group_interrupt_defaults migration
# switched to false in the backend while the dashboard kept showing true.
CONNECTIONS_UC="$CONNECTIONS_UC" DASHBOARD_TS="$DASHBOARD_TS" node - <<'NODE'
const fs = require('fs');

const uc = fs.readFileSync(process.env.CONNECTIONS_UC, 'utf8');
const ts = fs.readFileSync(process.env.DASHBOARD_TS, 'utf8');

const problems = [];

function ucFunctionBody(name) {
  const start = uc.indexOf(`function ${name}(`);
  if (start < 0) return null;
  const end = uc.indexOf('\n}\n', start);
  return end < 0 ? null : uc.slice(start, end);
}

// The backend reads a group option twice, once from the child section and once
// from the legacy settings map, and both spell out the same default. Taking the
// child-section default keeps the check on the shape current configurations use.
function ucDefault(name) {
  const body = ucFunctionBody(name);
  if (body === null) {
    problems.push(`${name}() is absent from config/connections.uc`);
    return null;
  }

  const child =
    /child_option_alias\(child, \[[^\]]*\], ("(?:[^"\\]|\\.)*")\)/.exec(body) ||
    /child_option\(child, "[a-z_]+", ("(?:[^"\\]|\\.)*")\)/.exec(body) ||
    /child_bool\(child, "[a-z_]+", (true|false)\)/.exec(body);
  if (!child) {
    problems.push(`${name}() has no recognisable default`);
    return null;
  }

  return child[1].startsWith('"') ? JSON.parse(child[1]) : child[1] === 'true';
}

function tsBlock(fnName) {
  const start = ts.indexOf(`function ${fnName}(`);
  if (start < 0) {
    problems.push(`${fnName}() is absent from getDashboardSections.ts`);
    return '';
  }
  const end = ts.indexOf('\n}\n', start);
  return end < 0 ? ts.slice(start) : ts.slice(start, end);
}

function tsDefault(block, option) {
  const string = new RegExp(
    `itemSettingString\\(\\s*settings,\\s*'${option}',\\s*('(?:[^'\\\\]|\\\\.)*')`,
    's',
  ).exec(block);
  if (string) return string[1].slice(1, -1);

  const bool = new RegExp(
    `itemSettingBoolean\\(\\s*settings,\\s*'${option}',\\s*(true|false)`,
    's',
  ).exec(block);
  if (bool) return bool[1] === 'true';

  const number = new RegExp(
    `itemSettingNumber\\(\\s*settings,\\s*'${option}',\\s*([0-9]+)`,
    's',
  ).exec(block);
  if (number) return Number(number[1]);

  problems.push(`getDashboardSections.ts has no default for ${option}`);
  return null;
}

const urlTest = tsBlock('getUrlTestConfigs');
const fallback = tsBlock('getFallbackConfigs');

// backend accessor -> [dashboard block, UCI option, how the backend value reads]
const checks = [
  ['urltest_testing_url', urlTest, 'urltest_testing_url', (v) => v],
  ['urltest_expected_status', urlTest, 'expected_status', (v) => v],
  ['urltest_check_interval', urlTest, 'urltest_check_interval', (v) => v],
  ['urltest_tolerance', urlTest, 'urltest_tolerance', (v) => Number(v)],
  ['urltest_interrupt_exist_connections', urlTest, 'interrupt_exist_connections', (v) => v],
  ['fallback_group_health_check_url', fallback, 'health_check_url', (v) => v],
  ['fallback_group_health_check_interval', fallback, 'health_check_interval', (v) => v],
  ['fallback_group_health_check_timeout', fallback, 'health_check_timeout', (v) => v],
  ['fallback_group_attempt_timeout', fallback, 'attempt_timeout', (v) => v],
  ['fallback_group_expected_status', fallback, 'expected_status', (v) => v],
  ['fallback_group_idle_timeout', fallback, 'idle_timeout', (v) => v],
  ['fallback_group_interrupt_exist_connections', fallback, 'interrupt_exist_connections', (v) => v],
];

for (const [accessor, block, option, convert] of checks) {
  if (!block) continue;
  const backend = ucDefault(accessor);
  const frontend = tsDefault(block, option);
  if (backend === null || frontend === null) continue;
  const expected = convert(backend);
  if (expected !== frontend) {
    problems.push(
      `${option}: config/connections.uc uses ${JSON.stringify(expected)}, ` +
        `getDashboardSections.ts uses ${JSON.stringify(frontend)}`,
    );
  }
}

// urltest idle_timeout is the one option the backend leaves empty on purpose so
// that the generated outbound omits it and sing-box applies its own 30 minutes.
// The dashboard has to name that value, so it is checked against sing-box rather
// than against an empty backend default.
if (ucDefault('urltest_idle_timeout') !== '') {
  problems.push(
    'urltest_idle_timeout no longer defaults to an omitted field; the dashboard ' +
      'default has to be revisited together with it',
  );
}
if (tsDefault(urlTest, 'idle_timeout') !== '30m') {
  problems.push(
    "urltest idle_timeout must show sing-box's own 30m default when UCI omits it",
  );
}

if (problems.length) {
  console.error(`FAIL: ${problems.join('\nFAIL: ')}`);
  process.exit(1);
}
NODE

printf 'dashboard group default checks passed\n'
