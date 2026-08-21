import { describe, expect, it } from 'vitest';

import {
  createUciStub,
  loadLuciView,
  resetLuciViewCache,
} from './loadLuciView';

// A widget as LuCI mounts it: the frame carries the cbid and the instance, and the
// value in it is the one the user just picked, which is not yet in the configuration.
function widget(sectionId, name, value) {
  return {
    [`cbid.forkop.${sectionId}.${name}`]: {
      instance: { getValue: () => value },
    },
  };
}

function load(server, widgets = {}) {
  resetLuciViewCache();
  const uci = createUciStub({
    srv: { '.type': 'server', label: 'Home', enabled: '1', ...server },
  });
  return loadLuciView(
    'server',
    uci,
    ['isAuthenticationEnabled', 'visibleClientFields', 'liveOption'],
    widgets,
  );
}

// While a dialog is open the widget holds the answer and the configuration holds the
// previous one, so every reader has to look at the widget. A checkbox does not name
// its inner control widget.<cbid> - it puts that in data-widget-id and gives the
// input a random id - so a reader that looked for the control saw nothing for a flag
// and silently answered from the configuration.
describe('live option values', () => {
  it('reads a flag from its widget, not from the configuration', () => {
    const view = load(
      { protocol: 'mixed', mixed_auth_enabled: '0' },
      widget('srv', 'mixed_auth_enabled', '1'),
    );

    expect(view.liveOption('srv', 'mixed_auth_enabled')).toBe('1');
    expect(view.isAuthenticationEnabled('srv')).toBe(true);
  });

  // The bug this guards: authentication switched on but not applied yet, and the
  // client dialog came up without the password field.
  it('offers a password once authentication is switched on', () => {
    const off = load({ protocol: 'mixed', mixed_auth_enabled: '0' });
    expect(off.visibleClientFields('srv')).toEqual([]);

    const pending = load(
      { protocol: 'mixed', mixed_auth_enabled: '0' },
      widget('srv', 'mixed_auth_enabled', '1'),
    );
    expect(pending.visibleClientFields('srv')).toEqual(['password']);
  });

  it('falls back to the configuration when no widget is mounted', () => {
    const view = load({ protocol: 'mixed', mixed_auth_enabled: '1' });

    expect(view.liveOption('srv', 'mixed_auth_enabled')).toBe('1');
    expect(view.visibleClientFields('srv')).toEqual(['password']);
  });
});
