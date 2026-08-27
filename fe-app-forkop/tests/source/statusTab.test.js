// The Status tab is two blocks side by side: the actions and system information
// on the left, the check results on the right. It is also the one tab whose
// width is decided by its own content rather than by the column it sits in - the
// value of a DummyValue reaches the theme inside an <output>, and the theme lays
// a .cbi-value out as a flex row, so the page is a shrink-to-fit box. Two
// fractions and the controls' floor settle that at 17rem + 34rem, which is the
// split a desktop window has always shown, and these checks hold it.
//
// Everything below the two-column plateau is the other half: the page has to
// keep shrinking while two columns still fit, fill the column it is given once
// they do not, and never let a value with nothing to break at push a track wider
// than the space there is.
import fs from 'fs';

import { describe, expect, it } from 'vitest';

import { SRC } from '../lib/paths.js';

const read = (relative) => fs.readFileSync(`${SRC}/${relative}`, 'utf8');

const styles = read('forkop/tabs/diagnostic/styles.ts');
const render = read('forkop/tabs/diagnostic/renderDiagnostic.ts');
const checkSection = read(
  'forkop/tabs/diagnostic/partials/renderCheckSection.ts',
);

// The block of a CSS rule, from its selector to the closing brace in column zero.
function cssRule(selector) {
  const start = styles.indexOf(`\n${selector} {`);
  expect(start, `${selector} was not found`).toBeGreaterThanOrEqual(0);
  const end = styles.indexOf('\n}', start);
  return styles.slice(start, end);
}

// The body of the one media query the page declares, by the width it breaks at,
// and the empty string when the page does not declare it - so that each check
// below fails saying what it wanted rather than all of them failing at once on
// the query being absent.
function mediaQuery(condition) {
  const start = styles.indexOf(`@media ${condition} {`);
  if (start < 0) return '';
  const end = styles.indexOf('\n}\n', start);
  return styles.slice(start, end);
}

const page = cssRule('.fkp_diagnostic-page');
const controls = cssRule('.fkp_diagnostic-page__controls');
const alert = cssRule('.fkp_diagnostic_alert');
const summaryItem = cssRule('.fkp_diagnostic_alert__summary__item');

describe('the two columns', () => {
  // Both tracks stay fractions because the page is sized against its own
  // content: a lone fr track in a shrink-to-fit box is sized to what is inside
  // it, and the checks would end up as narrow as the longest word in them.
  it('are fractions of each other', () => {
    expect(page).toContain('grid-template-columns: 1fr minmax(0, 2fr);');
  });

  // The floor the pair is measured against. "Sing-box 1.13.18-extended-2.6.5-f100"
  // takes 264px with the card padding around it, so 17rem leaves a few pixels
  // over, and 1fr:2fr makes the checks twice that - the 272/544 split of a
  // desktop window.
  it('take their floor from the controls', () => {
    expect(controls).toContain('min-width: 17rem;');
  });

  // System information arrives one value at a time. A column measured against it
  // steps sideways once per row while the page fills in, so the block is kept out
  // of that measurement entirely.
  it('do not measure themselves against system information', () => {
    expect(cssRule('.fkp_diagnostic-page__controls__system-info')).toContain(
      'width: 0;\n    min-width: 100%;',
    );
  });
});

describe('a narrower window', () => {
  const narrow = mediaQuery('(max-width: 620px)');

  // The controls hold 17rem whatever happens, so the checks beside them are what
  // a narrower page takes from: 473px at a 780px window, 348px at 640px. The
  // stack used to arrive at 800px, with the checks still 493px wide and a third
  // of the content column left empty beside them.
  it('keeps both columns until the checks fall under 19rem', () => {
    expect(styles).not.toContain('@media (max-width: 800px)');
    expect(narrow).toContain('grid-template-columns: minmax(0, 1fr);');
  });

  // Stacked, the page has to take the width it is given. Left to size itself it
  // settles on its own content - 444px inside a 774px column, hugging its left
  // edge - so the mount node becomes a block and the page fills it, which is what
  // the Dashboard tab does for the same reason.
  it('makes the page fill the column it is given', () => {
    expect(narrow).toContain(
      '-diagnostic-_mount_node {\n        display: block;',
    );
    expect(narrow).toContain('width: 100%;');
  });

  // The floor exists so a column can be measured against it. Stacked there is no
  // measurement left to make, and on a 320px screen the floor is wider than the
  // container.
  it('drops the floor the two columns were measured against', () => {
    expect(narrow).toContain(
      '.fkp_diagnostic-page__controls {\n        min-width: 0;',
    );
  });
});

describe('a check result', () => {
  // A track with an automatic minimum is at least as wide as the longest thing
  // inside it, so a version string or an address list with nothing to break at
  // widens the track past the space there is and takes the page with it.
  it.each([
    ['the checks column', page, '1fr minmax(0, 2fr)'],
    ['the alert body', alert, '24px minmax(0, 1fr)'],
    ['the summary row', summaryItem, '16px minmax(0, 1fr)'],
  ])('lets %s shrink below its content', (_name, rule, columns) => {
    expect(rule).toContain(`grid-template-columns: ${columns};`);
  });

  // A key took as much width as it needed and the value got the rest, which on a
  // narrow page was nothing: "Server #1: Публичный адрес" measures 183px, and
  // against a 209px row that left 26px for the address it labels. The two wrap
  // against each other instead.
  it('stacks a value under its key when they stop fitting side by side', () => {
    const body = cssRule('.fkp_diagnostic_alert__summary__item__body');
    expect(body).toContain('flex-wrap: wrap;');
    expect(cssRule('.fkp_diagnostic_alert__summary__item__value')).toContain(
      'flex: 1 1 8rem;',
    );
  });

  it.each(['__key', '__value'])(
    'breaks a %s with nothing to break at',
    (cell) => {
      expect(cssRule(`.fkp_diagnostic_alert__summary__item${cell}`)).toContain(
        'overflow-wrap: anywhere;',
      );
    },
  );

  it('names the cells the stylesheet addresses', () => {
    expect(checkSection).toContain('fkp_diagnostic_alert__summary__item__body');
    expect(checkSection).toContain('fkp_diagnostic_alert__summary__item__key');
    expect(checkSection).toContain(
      'fkp_diagnostic_alert__summary__item__value',
    );
  });
});

// Stacked into one column, the whole list of checks would otherwise stand
// between the page and the buttons that act on it.
describe('the markup', () => {
  it('puts the controls before the results', () => {
    expect(render.indexOf('__controls')).toBeLessThan(
      render.indexOf('__results'),
    );
  });
});
