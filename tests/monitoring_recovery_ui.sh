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
if (errorStart < 0 || !errorHandler.includes('startConnectionsPolling()')) {
  throw new Error('direct Clash WebSocket errors must fall back to RPC polling');
}
// The socket manager retries on its own, so the poll covers the gap instead of
// replacing the live updates: a core that restarts must not pin an open tab to
// the slow transport for the rest of its life.
if (errorHandler.includes('socket.disconnect')) {
  throw new Error('a failed Clash WebSocket must keep its subscription so it can reconnect');
}
if (!monitoring.includes('stopConnectionsPolling();\n\n      try {')) {
  throw new Error('a Clash WebSocket message must stop the poll that covered for it');
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

// The tab asks the Clash API and shows what it answers. Nothing here reads the
// service state: a stopped core is an unanswered request like any other.
for (const forbidden of ['serviceAvailability', 'runtimeUiState']) {
  if (monitoring.includes(forbidden)) {
    throw new Error(`monitoring must not gate its own data on the service state: ${forbidden}`);
  }
}

// A stopped core answers nothing for as long as the tab stays open.
for (const expected of [
  'CONNECTIONS_RPC_POLL_BACKOFF_MAX_MS',
  'consecutivePollFailures',
  'scheduleConnectionsPoll(connectionsPollDelay())',
]) {
  if (!monitoring.includes(expected)) {
    throw new Error(`a failing connections poll must back off: ${expected}`);
  }
}

// A socket to a port that drops packets neither connects nor fails for as long
// as the browser's own connect timeout runs, and the table would show nothing
// at all for that whole time.
for (const expected of [
  'CONNECTIONS_SOCKET_GRACE_MS',
  'connectionsSocketGraceTimer = setTimeout',
]) {
  if (!monitoring.includes(expected)) {
    throw new Error(`a socket that never connects must not hold up the table: ${expected}`);
  }
}

// What the poll costs the router decides how often it may run again: a request
// carried by the CLI transport, or a connection list that has grown large, is
// not something to ask for every second and a half.
for (const expected of [
  "import { pollDelayForDuration } from '../../helpers/pollDelay'",
  'pollDelayForDuration(',
  'lastConnectionsPollDurationMs',
]) {
  if (!monitoring.includes(expected)) {
    throw new Error(`the connections poll must pace itself by what it costs: ${expected}`);
  }
}
NODE

printf 'monitoring recovery UI checks passed\n'
