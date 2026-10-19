import { describe, expect, it } from 'vitest';

import { pageTitle } from '../pageTitle';

describe('the page title', () => {
  // The page is the whole app, and one of its tabs is already called Settings.
  it('names the product and the version of the page, then the service state', () => {
    expect(pageTitle('1.0.6')).toBe(
      'Forkop <small>1.0.6</small> <small id="fkp_page-status"></small>',
    );
  });

  it('shows no version a development build does not have', () => {
    expect(pageTitle('__COMPILED_VERSION_VARIABLE__')).toBe(
      'Forkop <small id="fkp_page-status"></small>',
    );
  });
});
