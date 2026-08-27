// Everything the Dashboard shows about outbounds comes from the Clash API. The
// configuration names the sections and describes their groups, but it never
// stands in for the runtime: a card that exists only because a section asked for
// it says nothing about what the core is actually running, and it used to be
// impossible to tell such a card from a group that is merely still starting.
import fs from 'fs';

import { describe, expect, it } from 'vitest';

import { SRC } from '../lib/paths.js';

const read = (relative) => fs.readFileSync(`${SRC}/${relative}`, 'utf8');

const sections = read('forkop/methods/custom/getDashboardSections.ts');
const renderSections = read('forkop/tabs/dashboard/partials/renderSections.ts');
const controller = read('forkop/tabs/dashboard/initController.ts');
const render = read('forkop/tabs/dashboard/render.ts');
const styles = read('forkop/tabs/dashboard/styles.ts');

describe('the cards of a section', () => {
  it('come from its runtime selector', () => {
    expect(sections).toContain('const outbounds = uniqueCodes(selectorCodes)');
  });

  it.each(['selectorFallbackCodes', 'builtInUrltestCode'])(
    'do not replace a missing selector from the configuration: %s',
    (gone) => {
      expect(sections).not.toContain(gone);
    },
  );

  it('bind a configured group to a runtime group by name and nothing else', () => {
    expect(sections).not.toContain(
      'candidates.find((candidate) => remaining.has(candidate))',
    );
  });

  // Only the card that stands for a whole section can report a missing
  // outbound; a group card exists because the runtime reported it.
  it('report a missing outbound only for the single-outbound section card', () => {
    expect(sections.split('runtimeAvailable')).toHaveLength(2);
  });

  it('recognise an empty group by its member list', () => {
    expect(renderSections).toContain(
      'const hasGroupMembers = !groupInfo || groupInfo.outbounds.length > 0',
    );
  });
});

// The tab asks the Clash API and renders the answer. A stopped core is a request
// that goes unanswered, not a reason to refuse to look.
describe('the tab', () => {
  it.each([
    ['initController.ts', controller],
    ['render.ts', render],
    ['styles.ts', styles],
  ])('does not gate %s on the service state', (_name, source) => {
    expect(source).not.toContain('serviceAvailability');
    expect(source).not.toContain('service-stopped');
  });

  it('starts its updates when the tab is mounted', () => {
    expect(controller).toContain('startDashboardDataUpdates();');
  });

  // An HTTPS page cannot open a plaintext WebSocket, and a controller the browser
  // does not reach answers no differently. The widgets those sockets feed are
  // polled out of the connections snapshot instead of staying unavailable.
  it.each([
    'if (canUseDirectClashApi()) {',
    'void connectToClashSockets(dataUpdatesId);',
    'startWidgetsPolling(dataUpdatesId);',
    'WIDGETS_POLL_BACKOFF_MAX_MS',
    // A socket that neither connects nor fails must not leave the widgets empty
    // for as long as the browser's own connect timeout runs.
    'widgetsSocketGraceTimer = setTimeout',
    // And what the poll costs the router decides how often it may run again.
    'pollDelayForDuration(',
    // The section refresh is the third loop on this tab and backs off like the
    // other two: a stopped core must not be asked every ten seconds forever.
    'SECTIONS_REFRESH_BACKOFF_MAX_MS',
    'scheduleSectionsRefresh(dataUpdatesId, sectionsRefreshDelay())',
  ])('survives a browser that cannot open the sockets: %s', (expected) => {
    expect(controller).toContain(expected);
  });
});
