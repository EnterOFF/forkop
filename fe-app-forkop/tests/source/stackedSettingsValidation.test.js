// A settings dialog opened on top of another one - a peer inside a tunnel, a
// level inside a fallback group - refuses a save by marking the field that is
// wrong. The dialog itself adds nothing on top of that: no summary of its own,
// no toast repeating it somewhere else. And a refused save has to stay
// refusable: the modal stays open and the button goes back to being pressable.
import { describe, expect, it } from 'vitest';

import { tabDeclaration } from '../lib/tabSource.js';

describe('Save in a nested settings dialog', () => {
  const modal = () =>
    tabDeclaration('sections', 'renderStackedJsonSettingsModal');

  it('keeps the modal open after validation fails', async () => {
    expect(await modal()).toContain('.catch(() => {');
  });

  it('is retryable after validation fails', async () => {
    expect(await modal()).toContain('saveButton.disabled = false;');
  });

  it('supports asynchronous import handlers', async () => {
    expect(await modal()).toContain('Promise.resolve(');
  });

  it.each(['fkp-stacked-settings-validation-summary', 'showToast'])(
    'does not report a refusal through %s',
    async (forbidden) => {
      expect(await modal()).not.toContain(forbidden);
    },
  );
});
