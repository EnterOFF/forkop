// A group's settings dialog must open at once. The provider choices it offers
// come from the running core over the Clash API, and waiting for that answer
// before showing the dialog made every click on a group stall for as long as the
// request took; the dialog opens with what it has and fills the lists in when
// the answer arrives.
import { describe, expect, it } from 'vitest';

import { tabSource } from '../lib/tabSource.js';

describe('a group settings dialog', () => {
  it('does not wait for live provider choices before opening', async () => {
    expect(await tabSource('sections')).not.toContain(
      'return loadOutboundNameChoices(sectionId).then(() =>',
    );
  });

  it('refreshes its choices after the background load', async () => {
    expect(await tabSource('sections')).toContain(
      'refreshDashboardFilterChoiceWidgets(section_id);',
    );
  });
});
