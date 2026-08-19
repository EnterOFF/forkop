#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node - \
  "$ROOT_DIR/fe-app-forkop/src/forkop/tabs/monitoring/initController.ts" \
  "$ROOT_DIR/fe-app-forkop/src/forkop/methods/fakeip/getFakeIpCheck.ts" \
  "$ROOT_DIR/fe-app-forkop/src/forkop/methods/fakeip/getIpCheck.ts" \
  "$ROOT_DIR/fe-app-forkop/src/forkop/tabs/monitoring/styles.ts" <<'NODE'
const fs = require('fs');
const monitoring = fs.readFileSync(process.argv[2], 'utf8');
const fakeIp = fs.readFileSync(process.argv[3], 'utf8');
const ip = fs.readFileSync(process.argv[4], 'utf8');
const styles = fs.readFileSync(process.argv[5], 'utf8');

const errorStart = monitoring.indexOf('(_err) => {');
const errorEnd = monitoring.indexOf('function startConnectionsUpdates()', errorStart);
const errorHandler = monitoring.slice(errorStart, errorEnd);
if (
  errorStart < 0 ||
  !errorHandler.includes('socket.disconnect(failedSocketUrl)') ||
  !errorHandler.includes('startConnectionsPolling()')
) {
  throw new Error('direct Clash WebSocket errors must fall back to RPC polling');
}

for (const source of [fakeIp, ip]) {
  if (source.includes("'Content-Type': 'application/json'")) {
    throw new Error('cross-origin diagnostic GET must stay a simple CORS request');
  }
}

for (const expected of [
  "const SYSTEM_DEVICE_VALUE = '@system'",
  "new Set(['system-in', 'system6-in'])",
  'isSystemConnection(connection)',
  "primary: 'System'",
  '? SYSTEM_DEVICE_VALUE',
]) {
  if (!monitoring.includes(expected)) {
    throw new Error(`monitoring must identify System by its dedicated inbound: ${expected}`);
  }
}

for (const expected of [
  "querySelector(\n        '.fkp_monitoring-page__table-wrap'",
  'tableWrap.scrollLeft = previousScrollLeft',
]) {
  if (!monitoring.includes(expected)) {
    throw new Error(`monitoring refresh must preserve table scroll position: ${expected}`);
  }
}

if (/class: '(?:[^']*\s)?(?:table|cbi-section-table)(?:\s|')/.test(monitoring)) {
  throw new Error(
    'the connections table must not carry LuCI table classes: the theme turns them into a flex column on phones and misaligns the headers',
  );
}

if (
  !monitoring.includes("'fkp_monitoring-page__row',") ||
  !styles.includes('.fkp_monitoring-page__row {') ||
  !styles.includes('@media (max-width: 640px)')
) {
  throw new Error(
    'connection rows must keep the class the narrow-screen card layout is built on',
  );
}

for (const expected of [
  'countFilteredConnections(activeConnections)',
  'countFilteredConnections(closedConnections)',
  'searchQuery = searchInput.value;\n      renderControls();',
  'selectedDeviceFilter = select.value || ALL_FILTER_VALUE;\n      renderControls();',
]) {
  if (!monitoring.includes(expected)) {
    throw new Error(`monitoring tab counters must follow the active filters: ${expected}`);
  }
}
NODE

printf 'monitoring recovery UI checks passed\n'
