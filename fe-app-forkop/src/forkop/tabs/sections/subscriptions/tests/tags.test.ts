import { describe, expect, it } from 'vitest';

import { installUciStub } from '../../../../../helpers/tests/luciStubs';
import { addSubscriptionUrlItemOptions } from '../options';
import {
  configuredSubscriptionTags,
  nextSubscriptionTag,
  reserveSubscriptionTags,
} from '../model';

// Every subscription of a section carries a tag, because the runtime turns it
// into the provider name "<section>/<tag>" and sing-box refuses a configuration
// holding two providers under one name. Nobody has to type it: the list names an
// entry the moment its link is added.
//
// The list the numbering counts is the one the user is looking at, not the stored
// one: an entry added or taken out is only written when the section is saved, so
// until then a removed subscription must stop holding its number and an added one
// must already hold its own.

const SECTION = 'section_probe';

// The list option, as far as the tag rules are concerned: the entries it shows
// and the staged settings it keeps for the ones with no section yet.
function listOption(values: string[]) {
  return {
    formvalue: () => values,
    pendingChildSettings: {},
  } as unknown as CBIOption;
}

function stagedTag(option: CBIOption, value: string) {
  return option.pendingChildSettings?.[SECTION]?.[value]?.tag;
}

// A stored subscription of the probe section.
function storedSubscription(
  sections: Record<string, Record<string, string>>,
  itemId: string,
  tag: string,
) {
  sections[itemId] = {
    '.type': 'subscription_url',
    section: SECTION,
    url: `https://example.com/${itemId}`,
    tag,
  };
  return itemId;
}

describe('naming a subscription that was just added', () => {
  it('names the first one of a section sub1', () => {
    installUciStub({});
    const option = listOption(['https://example.com/first']);

    reserveSubscriptionTags(SECTION, option, ['https://example.com/first']);

    expect(stagedTag(option, 'https://example.com/first')).toBe('sub1');
  });

  it('numbers it after the subscriptions the section already has', () => {
    const sections: Record<string, Record<string, string>> = {};
    storedSubscription(sections, 'sub_first', 'sub1');
    installUciStub(sections);
    const values = ['sub_first', 'https://example.com/second'];
    const option = listOption(values);

    reserveSubscriptionTags(SECTION, option, values);

    expect(stagedTag(option, 'https://example.com/second')).toBe('sub2');
  });

  // Numbering counts rather than looking for a hole, so a section whose
  // subscriptions are sub2 and sub3 does not hand the new one the free sub1.
  it('does not fill a gap the numbering left', () => {
    const sections: Record<string, Record<string, string>> = {};
    storedSubscription(sections, 'sub_first', 'sub2');
    storedSubscription(sections, 'sub_second', 'sub3');
    installUciStub(sections);
    const values = ['sub_first', 'sub_second', 'https://example.com/new'];
    const option = listOption(values);

    reserveSubscriptionTags(SECTION, option, values);

    expect(stagedTag(option, 'https://example.com/new')).toBe('sub4');
  });

  it('names two links added in a row differently', () => {
    installUciStub({});
    const first = ['https://example.com/a'];
    const both = ['https://example.com/a', 'https://example.com/b'];
    const option = listOption(first);

    reserveSubscriptionTags(SECTION, option, first);
    option.formvalue = () => both;
    reserveSubscriptionTags(SECTION, option, both);

    expect(stagedTag(option, 'https://example.com/a')).toBe('sub1');
    expect(stagedTag(option, 'https://example.com/b')).toBe('sub2');
  });

  it('leaves the name an entry already has alone', () => {
    installUciStub({});
    const values = ['https://example.com/a'];
    const option = listOption(values);

    reserveSubscriptionTags(SECTION, option, values);
    reserveSubscriptionTags(SECTION, option, values);

    expect(stagedTag(option, 'https://example.com/a')).toBe('sub1');
  });

  // The section is not saved yet, so the removed subscriptions are still stored.
  // Their numbers are free all the same: the same save that writes the new one
  // deletes them.
  it('takes the numbers of subscriptions removed from the list', () => {
    const sections: Record<string, Record<string, string>> = {};
    storedSubscription(sections, 'sub_first', 'sub1');
    storedSubscription(sections, 'sub_second', 'sub2');
    installUciStub(sections);
    const values = ['https://example.com/new'];
    const option = listOption(values);

    reserveSubscriptionTags(SECTION, option, values);

    expect(stagedTag(option, 'https://example.com/new')).toBe('sub1');
  });

  it('moves past a number a subscription still in the list holds', () => {
    const sections: Record<string, Record<string, string>> = {};
    storedSubscription(sections, 'sub_first', 'sub1');
    storedSubscription(sections, 'sub_second', 'sub2');
    storedSubscription(sections, 'sub_third', 'sub3');
    installUciStub(sections);
    const values = ['sub_first', 'sub_third', 'https://example.com/new'];
    const option = listOption(values);

    reserveSubscriptionTags(SECTION, option, values);

    expect(stagedTag(option, 'https://example.com/new')).toBe('sub4');
  });

  it('gives the name up again when the link is taken back', () => {
    installUciStub({});
    const option = listOption(['https://example.com/a']);

    reserveSubscriptionTags(SECTION, option, ['https://example.com/a']);
    option.formvalue = () => [];
    reserveSubscriptionTags(SECTION, option, []);
    option.formvalue = () => ['https://example.com/b'];
    reserveSubscriptionTags(SECTION, option, ['https://example.com/b']);

    expect(stagedTag(option, 'https://example.com/a')).toBeUndefined();
    expect(stagedTag(option, 'https://example.com/b')).toBe('sub1');
  });

  // A list that has not rendered - a parse with no dialog on screen - answers
  // with nothing, and the stored children are then the whole truth.
  it('counts the stored subscriptions when no list is on screen', () => {
    const sections: Record<string, Record<string, string>> = {};
    storedSubscription(sections, 'sub_first', 'sub1');
    storedSubscription(sections, 'sub_second', 'sub2');
    installUciStub(sections);
    const option = { pendingChildSettings: {} } as unknown as CBIOption;

    expect(nextSubscriptionTag(SECTION, option)).toBe('sub3');
  });
});

describe('the tags a section counts as taken', () => {
  it('includes a stored one', () => {
    const sections: Record<string, Record<string, string>> = {};
    storedSubscription(sections, 'sub_first', 'sub1');
    installUciStub(sections);
    const option = listOption(['sub_first']);

    expect(configuredSubscriptionTags(SECTION, option)).toEqual(['sub1']);
  });

  it('includes one staged for a link whose dialog was never opened', () => {
    installUciStub({});
    const values = ['https://example.com/a'];
    const option = listOption(values);

    reserveSubscriptionTags(SECTION, option, values);

    expect(configuredSubscriptionTags(SECTION, option)).toEqual(['sub1']);
  });

  it('leaves out a subscription removed from the list', () => {
    const sections: Record<string, Record<string, string>> = {};
    storedSubscription(sections, 'sub_first', 'sub1');
    storedSubscription(sections, 'sub_second', 'sub2');
    installUciStub(sections);
    const option = listOption(['sub_first']);

    expect(configuredSubscriptionTags(SECTION, option)).toEqual(['sub1']);
  });

  it('leaves out the entry it is asked to skip', () => {
    const sections: Record<string, Record<string, string>> = {};
    storedSubscription(sections, 'sub_first', 'sub1');
    storedSubscription(sections, 'sub_second', 'sub2');
    installUciStub(sections);
    const option = listOption(['sub_first', 'sub_second']);

    expect(configuredSubscriptionTags(SECTION, option, ['sub_second'])).toEqual(
      ['sub1'],
    );
  });
});

// The dialog's own field, driven the way the modal drives it.
function tagValidator(values: string[], option: CBIOption, ownerId: string) {
  let validate: ((itemId: string, value: unknown) => true | string) | undefined;
  const section = {
    map: {},
    option: (_type: unknown, name: string) => {
      const created = {
        depends() {},
        value() {},
        set validate(
          handler: (itemId: string, value: unknown) => true | string,
        ) {
          if (name === 'tag') validate = handler;
        },
        get validate() {
          return validate as (itemId: string, value: unknown) => true | string;
        },
      };
      return created;
    },
  };

  addSubscriptionUrlItemOptions(section as unknown as CBISection, {
    parentSectionId: () => SECTION,
    ownerId: () => ownerId,
    itemValue: () => (values.includes(ownerId) ? '' : ownerId),
    listOption: option,
  });

  return validate!;
}

describe('typing a tag by hand', () => {
  it('is refused when a subscription in the list already holds it', () => {
    const sections: Record<string, Record<string, string>> = {};
    storedSubscription(sections, 'sub_first', 'sub1');
    storedSubscription(sections, 'sub_second', 'sub2');
    installUciStub(sections);
    const values = ['sub_first', 'sub_second'];
    const option = listOption(values);

    expect(
      tagValidator(values, option, 'sub_second')('settings', 'sub1'),
    ).toMatch(/unique/);
  });

  // The other subscription is only a link in the list, so nothing anywhere shows
  // the name it is going to be saved under.
  it('is refused when a link with no dialog opened holds it', () => {
    const sections: Record<string, Record<string, string>> = {};
    storedSubscription(sections, 'sub_first', 'sub1');
    installUciStub(sections);
    const values = ['sub_first', 'https://example.com/new'];
    const option = listOption(values);
    reserveSubscriptionTags(SECTION, option, values);

    expect(
      tagValidator(values, option, 'sub_first')('settings', 'sub2'),
    ).toMatch(/unique/);
  });

  it('is accepted when the subscription holding it was removed from the list', () => {
    const sections: Record<string, Record<string, string>> = {};
    storedSubscription(sections, 'sub_first', 'sub1');
    storedSubscription(sections, 'sub_second', 'sub2');
    installUciStub(sections);
    const values = ['sub_first'];
    const option = listOption(values);

    expect(tagValidator(values, option, 'sub_first')('settings', 'sub2')).toBe(
      true,
    );
  });

  it('is accepted when only the subscription itself holds it', () => {
    const sections: Record<string, Record<string, string>> = {};
    storedSubscription(sections, 'sub_first', 'sub1');
    installUciStub(sections);
    const values = ['sub_first'];
    const option = listOption(values);

    expect(tagValidator(values, option, 'sub_first')('settings', 'sub1')).toBe(
      true,
    );
  });

  it('refuses a name that would split the provider tag', () => {
    installUciStub({});
    const option = listOption([]);

    expect(tagValidator([], option, SECTION)('settings', 'a/b')).toMatch(
      /must not contain/,
    );
  });
});
