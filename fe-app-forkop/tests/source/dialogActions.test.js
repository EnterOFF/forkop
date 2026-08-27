// What a dialog's own footer does, and what its button is allowed to say.
//
// Forkop opens dialogs two ways. Most of them are a dialog of their own, and
// leaving one puts the page back: that button closes, and it sits at the left of
// the footer where the eye lands first. The settings dialogs stack instead - a
// nested map is laid over the one that opened it, and leaving that nested map
// restores the parent and its buttons rather than closing anything. A button
// that says "Close" there says the opposite of what it does.
//
// LuCI's own section dialog is not covered here: its buttons are the theme's,
// not ours.
import fs from 'fs';

import { describe, expect, it } from 'vitest';

import { SRC } from '../lib/paths.js';

const read = (relative) => fs.readFileSync(`${SRC}/${relative}`, 'utf8');

const dashboardStyles = read('forkop/tabs/dashboard/styles.ts');
const dashboard = read('forkop/tabs/dashboard/initController.ts');
const serverDetails = read('forkop/tabs/servers/details.ts');
const stackedModal = read('forkop/cbi/modal.ts');

// The block of a CSS rule, from its selector to the closing brace in column zero,
// and the empty string when the stylesheet has no such rule - so that a missing
// one fails the check that wanted it rather than the whole file at collection.
function cssRule(source, selector) {
  const start = source.indexOf(`\n${selector} {`);
  if (start < 0) return '';
  const end = source.indexOf('\n}', start);
  return source.slice(start, end);
}

describe('a dialog that closes', () => {
  // Both details dialogs of the Dashboard share one footer rule.
  it('puts the URLTest and Fallback action on the left', () => {
    expect(
      cssRule(dashboardStyles, '.fkp_dashboard-page__urltest-details__footer'),
    ).toContain('justify-content: flex-start;');
  });

  // The server details dialog and the QR code it opens share one button row.
  it('puts the server details and QR action on the left', () => {
    expect(serverDetails).toContain(
      '.modal > .button-row.fkp-details-actions{justify-content:flex-start;',
    );
  });

  it.each([
    ['the Dashboard details dialogs', dashboard],
    ['the server details and QR dialogs', serverDetails],
  ])('leaves %s with Close', (_name, source) => {
    expect(source).toContain("_('Close')");
  });
});

describe('a dialog that stacks', () => {
  it('leaves with Back rather than Close', () => {
    expect(stackedModal).toContain("_('Back')");
    expect(stackedModal).not.toContain("_('Close')");
  });

  // The label is only right because this is what the click does: the nested map
  // is taken out and the parent's own button row is put back.
  it('restores the dialog underneath it', () => {
    expect(stackedModal).toContain("activeMap.classList.remove('hidden')");
    expect(stackedModal).toContain('restoreButtonRow();');
  });
});

// A node of a URLTest or Fallback group: its name and measured latency, and the
// row's own action. All three fit on one line on a wide window and cannot on a
// narrow one, and which rows need the break depends on how long each name is.
describe('a node row', () => {
  const row = cssRule(
    dashboardStyles,
    '.fkp_dashboard-page__urltest-details__row',
  );
  const body = cssRule(
    dashboardStyles,
    '.fkp_dashboard-page__urltest-details__row-body',
  );

  // Placed after a latency that spanned the whole row, auto-placement put the
  // action on a third line of its own and every row of a hundred stood 86px tall.
  it('keeps the row action in a column of its own', () => {
    expect(row).toContain('grid-template-columns: minmax(0, 1fr) 20px;');
  });

  // The name takes the room that is left and the latency is flush with the
  // row's right edge, which is where the fixed latency column used to put it.
  it('wraps the name against its latency rather than at a window width', () => {
    expect(body).toContain('flex-wrap: wrap;');
    expect(dashboardStyles).toContain(
      '.fkp_dashboard-page__urltest-details__row-name {\n    flex: 1 1 auto;',
    );
    expect(dashboardStyles).toContain(
      '.fkp_dashboard-page__urltest-details__row-meta {\n    flex: 0 0 auto;\n    margin-left: auto;',
    );
  });

  // The details dialog has one media query of its own, after its footer rule -
  // the Dashboard's widget grid has another at the same width. It keeps the
  // parameter list, which has no such per-row choice to make, and nothing else.
  it('is not rewritten by the narrow-window rules', () => {
    const afterFooter = dashboardStyles.slice(
      dashboardStyles.indexOf('.fkp_dashboard-page__urltest-details__footer {'),
    );
    const query = afterFooter.slice(
      afterFooter.indexOf('@media (max-width: 560px)'),
    );
    const body560 = query.slice(0, query.indexOf('\n}\n'));
    expect(body560).toContain('__params');
    expect(body560).not.toContain('__row');
  });

  it.each(['renderUrlTestInfoModal', 'renderFallbackMemberRow'])(
    '%s builds the shared cell',
    (renderer) => {
      const from = dashboard.indexOf(`function ${renderer}`);
      expect(from, `${renderer} was not found`).toBeGreaterThanOrEqual(0);
      const source = dashboard.slice(from, dashboard.indexOf('\n}\n', from));
      expect(source).toContain(
        "class: 'fkp_dashboard-page__urltest-details__row-body'",
      );
    },
  );
});
