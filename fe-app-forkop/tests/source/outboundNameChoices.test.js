// Where the names a filter may be given come from.
//
// The behaviour is exercised as calls in
// src/forkop/tabs/sections/tests/outboundNames.test.ts. What is left here is the
// wiring around it, which is not reachable as a call: which widget the section
// tracks for live values, and that nothing rewrites a filter value the user typed.
import { describe, expect, it } from 'vitest';

import { readFunction } from '../lib/sourceLiteral.js';
import { tabSource } from '../lib/tabSource.js';

const section = await tabSource('sections');

describe('a provider tag', () => {
  // It is the name the user sees for the section, plus the subscription tag,
  // because that is what the core names the provider it built.
  it('is built from the displayed section name and the subscription tag', () => {
    expect(section).toMatch(/`\$\{sectionDisplayName\}\/\$\{/);
  });

  it('is looked up one at a time from a subscription dialog', () => {
    expect(section).toMatch(/\[state\.providerTags\[providerIndex\]\]/);
    expect(section).toMatch(/ownerId: options\.ownerId/);
  });
});

describe('the connection URL list', () => {
  // A DynamicList that was rebuilt leaves its old node in the document, so the
  // section keeps the one it rendered rather than looking the id up again.
  const binding = (() => {
    const match = section.match(
      /o\.liveDynamicListNodes = new Map\(\);[\s\S]*?outboundNameSourceOptions\.set\('selector_proxy_links', o\);/,
    );
    expect(
      match,
      'the connection URL DynamicList binding was not found',
    ).toBeTruthy();
    return match[0];
  })();

  it('is tracked per section', () => {
    expect(binding).toContain('o.liveDynamicListNodes = new Map();');
    expect(binding).toContain(
      "outboundNameSourceOptions.set('selector_proxy_links', o);",
    );
  });

  // LuCI recalculates depends() on every edit of a list, so removing a URL has to
  // reach the filter choices before Apply rather than after a reload.
  it('refreshes the filter choices while it is being edited', () => {
    expect(binding).toContain("addEventListener('cbi-dynlist-change'");
    expect(section).toContain(
      'o.onListChange = refreshDashboardFilterChoiceWidgets;',
    );
  });
});

describe('a filter value the user typed', () => {
  it('is not rewritten when the choices are refreshed', () => {
    expect(
      readFunction(section, 'configureLiveDynamicListChoices'),
    ).not.toMatch(/widget\.setValue\(/);
  });

  // A source that is renamed or deleted leaves the filter value alone: it is a
  // pattern the user wrote, not a reference the page owns.
  it('stays literal when its source is renamed or removed', () => {
    expect(section).not.toMatch(
      /renameServerFilterOutbound|outboundNameRenameAliases|removedOutboundNames/,
    );
  });
});
