// The Logs tab shows the router's own log, and it is the one tab whose content
// is not a form: a fixed-width block that has to stay inside the LuCI content
// column, scroll rather than push the page sideways, and take its colours from
// whichever theme the user has.
import fs from 'fs';

import { describe, expect, it } from 'vitest';

import { SRC } from '../lib/paths.js';
import { tabSource } from '../lib/tabSource.js';

const read = (relative) => fs.readFileSync(`${SRC}/${relative}`, 'utf8');
const readAll = (dir) => {
  const walk = (current, out = []) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = `${current}/${item.name}`;
      if (item.isDirectory()) walk(full, out);
      else out.push(fs.readFileSync(full, 'utf8'));
    }
    return out;
  };
  return walk(`${SRC}/${dir}`).join('\n');
};

const mount = read('forkop/tabs/mountTab.ts');
const render = read('forkop/tabs/logs/render.ts');
const controller = read('forkop/tabs/logs/initController.ts');
const styles = read('forkop/tabs/logs/styles.ts');
const diagnostic = readAll('forkop/tabs/diagnostic');
const logs = readAll('forkop/tabs/logs');

describe('the tab', () => {
  it('sits between Monitoring and Components', async () => {
    const entry = await tabSource('entry');
    const at = (needle) => entry.indexOf(needle);
    expect(at("'monitoring'")).toBeLessThan(at("'logs'"));
    expect(at("'logs'")).toBeLessThan(at("'updates'"));
  });

  it('is declared as a mounted tab', async () => {
    const entry = await tabSource('entry');
    expect(entry).toContain("_('Logs')");
    expect(entry).toContain(
      "addMountedTab(forkopMap, 'logs', _('Logs'), LogsTab)",
    );
  });

  // Through the shared mount, so the node the controller bound to is the one the
  // form puts back when it rebuilds itself. Answering with a freshly rendered
  // tree left the pane showing its placeholder from the first edit until a page
  // reload.
  it('goes through the shared mount', () => {
    expect(mount).toContain('mountTab(key, tab.render, tab.initController)');
  });

  it('does not render a new tree on every form rebuild', () => {
    expect(mount).not.toMatch(/=>\s*tab\.render\(\)/);
  });

  it('replaced the old Diagnostics action rather than sitting beside it', () => {
    expect(diagnostic).not.toMatch(/View logs|viewLogs|handleViewLogs/);
  });
});

describe('the controls', () => {
  it('offer auto refresh, on by default', () => {
    expect(render).toContain("id: 'logs-auto-refresh'");
    expect(controller).toContain('autoRefresh.checked = true');
  });

  it('search through the same field the Monitoring tab uses', () => {
    expect(render).toContain(
      "class: 'cbi-input-text fkp_logs-page__search-input'",
    );
  });

  // The log belongs to the system, and everything else in it is somebody else's
  // record of what happened. The runtime's half of this is tests/log_hygiene.sh.
  it('offer no way to clear the whole system log', () => {
    expect(
      [logs, readAll('forkop/methods'), read('forkop/types.ts')].join('\n'),
    ).not.toMatch(/logs-clear|clearLogs|clear_logs|clear-logs/);
  });

  it.each([
    [
      'the removed Forkop-only filter',
      logs,
      /Forkop only|logs-forkop-only|FORKOP_SOURCE_PATTERN|forkopOnly/,
    ],
    [
      'the refresh button and source selector',
      render,
      /logs-refresh|logs-source|_\('Refresh'\)/,
    ],
    [
      'the removed line counter',
      `${render}\n${controller}`,
      /logs-summary|countLines|updateSummary/,
    ],
    [
      'inline code highlighting',
      `${render}\n${controller}`,
      /E\('code'|logs-content/,
    ],
  ])('keep no trace of %s', (_label, source, pattern) => {
    expect(source).not.toMatch(pattern);
  });
});

describe('the log viewer', () => {
  it.each([
    ['stays within the LuCI content width', 'max-width: 100% !important;'],
    ['scrolls instead of overflowing the page', 'overflow-x: auto !important;'],
    ['does not wrap a line', 'white-space: pre;'],
    ['is fixed to the LuCI content block', 'width: 100% !important;'],
    ['does not change the viewer width', 'contain: inline-size;'],
  ])('%s', (_label, declaration) => {
    expect(styles).toContain(declaration);
  });

  it('inherits colours and typography from the active theme', () => {
    expect(styles).not.toMatch(
      /#1b1d1f|#f2f2f2|Canvas(Text)?|color-scheme:|ui-monospace/,
    );
  });
});
