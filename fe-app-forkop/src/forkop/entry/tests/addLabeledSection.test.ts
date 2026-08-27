import { describe, expect, it, vi } from 'vitest';

vi.mock('../../cbi/childItems', () => ({
  nextSectionId: (typeName: string) => `${typeName}_a1b2c3`,
}));

import { addLabeledSection } from '../gridSection';

// Add creates the row before its dialog opens, so the row needs a name at once.
// The id says which type the section is - it is never shown - and the label is the
// free-form name the dialog offers, numbered one past what is already on screen.

function grid(sectiontype: string) {
  const written: { requestedId?: string; label?: unknown } = {};
  const sectionRef = {
    sectiontype,
    cfgsections: () => ['active-1', 'active-2'],
    map: {
      config: 'forkop',
      data: {
        add: (_config: string, _type: string, sectionId: string) => {
          written.requestedId = sectionId;
          return 'cfg-new';
        },
        set: (
          _config: string,
          _sectionId: string,
          _option: string,
          value: unknown,
        ) => {
          written.label = value;
        },
      },
    },
  };
  return { sectionRef: sectionRef as unknown as CBISection, written };
}

describe.each([
  ['section', 'Section #3'],
  ['server', 'Server #3'],
])('adding a %s row', (sectiontype, expectedLabel) => {
  it('creates it under an id naming its type, labelled for the user', () => {
    const { sectionRef, written } = grid(sectiontype);

    expect(addLabeledSection(sectionRef)).toBe('cfg-new');
    expect(written.requestedId).toBe(`${sectiontype}_a1b2c3`);
    expect(written.label).toBe(expectedLabel);
  });
});
