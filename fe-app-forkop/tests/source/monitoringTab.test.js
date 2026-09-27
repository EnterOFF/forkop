// The Monitoring tab shows the connections the core is carrying, and it gets
// them over the Clash API - a WebSocket while the browser can open one, an RPC
// poll otherwise. Every rule below is about that transport surviving something:
// a core that restarts, a socket that neither connects nor fails, a poll that
// costs more than the interval it runs on.
import fs from 'fs';

import { describe, expect, it } from 'vitest';

import { SRC } from '../lib/paths.js';

const read = (relative) => fs.readFileSync(`${SRC}/${relative}`, 'utf8');

const monitoring = read('forkop/tabs/monitoring/initController.ts');
const styles = read('forkop/tabs/monitoring/styles.ts');
const fakeIp = read('forkop/methods/fakeip/getFakeIpCheck.ts');
const ip = read('forkop/methods/fakeip/getIpCheck.ts');

describe('a failed Clash WebSocket', () => {
  const errorHandler = (() => {
    const start = monitoring.indexOf('(_err) => {');
    const end = monitoring.indexOf('function startConnectionsUpdates()', start);
    expect(start, 'the socket error handler was not found').toBeGreaterThan(0);
    return monitoring.slice(start, end);
  })();

  it('falls back to RPC polling', () => {
    expect(errorHandler).toContain('startConnectionsPolling()');
  });

  // The socket manager retries on its own, so the poll covers the gap instead of
  // replacing the live updates: a core that restarts must not pin an open tab to
  // the slow transport for the rest of its life.
  it('keeps its subscription so it can reconnect', () => {
    expect(errorHandler).not.toContain('socket.disconnect');
  });

  it('gives the poll up again when a message arrives', () => {
    expect(monitoring).toContain('stopConnectionsPolling();\n\n      try {');
  });
});

// A request that carries no headers of its own stays a simple CORS request,
// which the browser sends without asking the other origin first.
describe.each([
  ['the FakeIP check', fakeIp],
  ['the public IP check', ip],
])('%s', (_label, source) => {
  it('stays a simple cross-origin GET', () => {
    expect(source).not.toContain("'Content-Type': 'application/json'");
  });
});

describe('the connections table', () => {
  it.each([
    "const SYSTEM_DEVICE_VALUE = '@system'",
    "new Set(['system-in', 'system6-in'])",
    'isSystemConnection(connection)',
    "primary: _('System')",
    '? SYSTEM_DEVICE_VALUE',
  ])('identifies System by its dedicated inbound: %s', (expected) => {
    expect(monitoring).toContain(expected);
  });

  it.each([
    "querySelector(\n        '.fkp_monitoring-page__table-wrap'",
    'tableWrap.scrollLeft = previousScrollLeft',
  ])('keeps its scroll position across a refresh: %s', (expected) => {
    expect(monitoring).toContain(expected);
  });

  // The theme turns a LuCI table into a flex column on phones, which misaligns
  // every header; the narrow-screen layout here is built on its own class.
  it('carries no LuCI table classes', () => {
    expect(monitoring).not.toMatch(
      /class: '(?:[^']*\s)?(?:table|cbi-section-table)(?:\s|')/,
    );
  });

  it('keeps the class the narrow-screen card layout is built on', () => {
    expect(monitoring).toContain("'fkp_monitoring-page__row',");
    expect(styles).toContain('.fkp_monitoring-page__row {');
    expect(styles).toContain('@media (max-width: 640px)');
  });

  it.each([
    'countFilteredConnections(activeConnections)',
    'countFilteredConnections(closedConnections)',
    'searchQuery = searchInput.value;\n      renderControls();',
    'selectedDeviceFilter = select.value || ALL_FILTER_VALUE;\n      renderControls();',
  ])('counts what the active filters leave: %s', (expected) => {
    expect(monitoring).toContain(expected);
  });
});

// The tab asks the Clash API and shows what it answers. Nothing here reads the
// service state: a stopped core is an unanswered request like any other.
describe('the tab', () => {
  it.each(['serviceAvailability', 'runtimeUiState'])(
    'does not gate its own data on %s',
    (forbidden) => {
      expect(monitoring).not.toContain(forbidden);
    },
  );

  // A stopped core answers nothing for as long as the tab stays open.
  it.each([
    'CONNECTIONS_RPC_POLL_BACKOFF_MAX_MS',
    'consecutivePollFailures',
    'connectionsPollDelay,',
  ])('backs a failing poll off: %s', (expected) => {
    expect(monitoring).toContain(expected);
  });

  // A socket to a port that drops packets neither connects nor fails for as
  // long as the browser's own connect timeout runs, and the table would show
  // nothing at all for that whole time.
  it.each([
    'CONNECTIONS_SOCKET_GRACE_MS',
    'connectionsSocketGraceTimer = setTimeout',
  ])('does not let a silent socket hold up the table: %s', (expected) => {
    expect(monitoring).toContain(expected);
  });

  // What the poll costs the router decides how often it may run again: a request
  // carried by the CLI transport, or a connection list that has grown large, is
  // not something to ask for every second and a half.
  it.each([
    "import { pollDelayForDuration } from '../../helpers/pollDelay'",
    'pollDelayForDuration(',
    'lastConnectionsPollDurationMs',
  ])('paces its poll by what it costs: %s', (expected) => {
    expect(monitoring).toContain(expected);
  });
});
