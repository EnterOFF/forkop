#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/forkop.js"
LOGS_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/logs.js"
DIAGNOSTIC_DIR="$ROOT_DIR/fe-app-forkop/src/forkop/tabs/diagnostic"
LOGS_RENDER="$ROOT_DIR/fe-app-forkop/src/forkop/tabs/logs/render.ts"
LOGS_CONTROLLER="$ROOT_DIR/fe-app-forkop/src/forkop/tabs/logs/initController.ts"
LOGS_STYLES="$ROOT_DIR/fe-app-forkop/src/forkop/tabs/logs/styles.ts"

node - "$FORKOP_JS" "$LOGS_JS" <<'NODE'
const fs = require('fs');
const entry = fs.readFileSync(process.argv[2], 'utf8');
const bridge = fs.readFileSync(process.argv[3], 'utf8');

const monitoring = entry.indexOf('const monitoringSection');
const logs = entry.indexOf('const logsSection');
const components = entry.indexOf('const updatesSection');

if (!(monitoring < logs && logs < components)) {
  console.error('FAIL: Logs tab must be between Monitoring and Components');
  process.exit(1);
}

for (const needle of [
  '"require view.forkop.logs as logs"',
  '_("Logs")',
  'logs.createLogsContent(logsSection)',
]) {
  if (!entry.includes(needle)) {
    console.error(`FAIL: missing Logs tab contract: ${needle}`);
    process.exit(1);
  }
}

// Through the shared mount, so the node the controller bound to is the one the
// form puts back when it rebuilds itself. Answering with a freshly rendered tree
// left the pane showing its placeholder from the first edit until a page reload.
if (!bridge.includes('main.mountTab("logs", main.LogsTab.render, main.LogsTab.initController)')) {
  console.error('FAIL: Logs LuCI bridge must mount the frontend tab through the shared mount');
  process.exit(1);
}
if (bridge.includes('main.LogsTab.render()')) {
  console.error('FAIL: Logs LuCI bridge must not render a new tree on every form rebuild');
  process.exit(1);
}
NODE

if grep -R -E 'View logs|viewLogs|handleViewLogs' "$DIAGNOSTIC_DIR" >/dev/null; then
  printf 'FAIL: Diagnostics must not retain the old View logs action\n' >&2
  exit 1
fi

if grep -R -E 'Forkop only|logs-forkop-only|FORKOP_SOURCE_PATTERN|forkopOnly' "$ROOT_DIR/fe-app-forkop/src/forkop/tabs/logs" >/dev/null; then
  printf 'FAIL: Logs must not retain the removed Forkop-only filter\n' >&2
  exit 1
fi
grep -Fq "id: 'logs-auto-refresh'" "$LOGS_RENDER" ||
  { printf 'FAIL: Logs must expose auto refresh\n' >&2; exit 1; }
grep -Fq "class: 'cbi-input-text fkp_logs-page__search-input'" "$LOGS_RENDER" ||
  { printf 'FAIL: Logs search must use the Monitoring-style field\n' >&2; exit 1; }
if grep -E "E\('code'|logs-content" "$LOGS_RENDER" "$LOGS_CONTROLLER" >/dev/null; then
  printf 'FAIL: Logs output must not inherit inline code highlighting\n' >&2
  exit 1
fi
grep -Fq 'autoRefresh.checked = true' "$LOGS_CONTROLLER" ||
  { printf 'FAIL: Logs auto refresh must be enabled by default\n' >&2; exit 1; }
if grep -E "logs-refresh|logs-source|_\('Refresh'\)" "$LOGS_RENDER" >/dev/null; then
  printf 'FAIL: Logs must not retain the refresh button or source selector\n' >&2
  exit 1
fi
if grep -E 'logs-summary|countLines|updateSummary' "$LOGS_RENDER" "$LOGS_CONTROLLER" >/dev/null; then
  printf 'FAIL: Logs must not retain the removed line counter\n' >&2
  exit 1
fi
if grep -R -E 'logs-clear|clearLogs|clear_logs|clear-logs' "$LOGS_RENDER" "$LOGS_CONTROLLER" "$ROOT_DIR/fe-app-forkop/src/forkop/methods" "$ROOT_DIR/fe-app-forkop/src/forkop/types.ts" "$ROOT_DIR/forkop/files/usr/bin/forkop" "$ROOT_DIR/forkop/files/usr/lib/diagnostics/runtime.uc" >/dev/null; then
  printf 'FAIL: Logs must not expose whole-system log clearing as a tab action\n' >&2
  exit 1
fi
grep -Fq 'max-width: 100% !important;' "$LOGS_STYLES" ||
  { printf 'FAIL: Logs must stay within the LuCI content width\n' >&2; exit 1; }
grep -Fq 'overflow-x: auto !important;' "$LOGS_STYLES" ||
  { printf 'FAIL: Logs must scroll instead of overflowing the page\n' >&2; exit 1; }
grep -Fq 'white-space: pre;' "$LOGS_STYLES" ||
  { printf 'FAIL: Log lines must not wrap\n' >&2; exit 1; }
grep -Fq 'width: 100% !important;' "$LOGS_STYLES" ||
  { printf 'FAIL: Logs width must be fixed to the LuCI content block\n' >&2; exit 1; }
grep -Fq 'contain: inline-size;' "$LOGS_STYLES" ||
  { printf 'FAIL: Log content must not change the viewer width\n' >&2; exit 1; }
if grep -E '#1b1d1f|#f2f2f2|Canvas(Text)?|color-scheme:|ui-monospace' "$LOGS_STYLES" >/dev/null; then
  printf 'FAIL: Logs must inherit colors and typography from the active LuCI theme\n' >&2
  exit 1
fi

printf 'LuCI logs checks passed\n'
