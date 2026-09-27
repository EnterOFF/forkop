// A settings dialog opened on top of another one - a peer inside a tunnel, a
// level inside a fallback group - keeps no summary of its own for a refused
// save, and a refused save has to stay refusable: the button goes back to being
// pressable. What the user is told is exercised as a save in
// tests/bundle/optionLifecycle.test.js.
import { describe, expect, it } from 'vitest';

import { tabDeclaration } from '../lib/tabSource.js';

describe('Save in a nested settings dialog', () => {
  const modal = () =>
    tabDeclaration('sections', 'renderStackedJsonSettingsModal');

  it('is retryable after validation fails', async () => {
    expect(await modal()).toContain('saveButton.disabled = false;');
  });

  it('supports asynchronous import handlers', async () => {
    expect(await modal()).toContain('Promise.resolve(');
  });

  it('keeps no validation summary of its own', async () => {
    expect(await modal()).not.toContain(
      'fkp-stacked-settings-validation-summary',
    );
  });
});
