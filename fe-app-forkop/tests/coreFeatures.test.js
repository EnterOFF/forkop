// What the page makes of the router's report about the installed core. The
// report and the link cases are fixtures the backend tests hold to
// singbox/features.uc, so the page and the router read a core the same way.
import { afterEach, describe, expect, it } from 'vitest';

import { coreFeatures, linkFeatureCases } from './lib/coreFeatures.js';
import {
  coreFeatureOfType,
  coreHas,
  coreSupportsType,
  linkCoreFeatures,
  missingCoreFeatureNote,
  missingCoreTags,
  setCoreFeatures,
  validateCoreFeature,
} from '../src/forkop/services/coreFeatures.service';
import { applyUiStateToStore } from '../src/forkop/services/uiState.service';
import {
  coreFilterTypeChoices,
  sectionMissingCoreFeatures,
} from '../src/forkop/tabs/sections/coreSupport';
import {
  groupTypeChoices,
  providerTypeChoices,
} from '../src/forkop/tabs/sections/providers';
import { installUciStub } from '../src/helpers/tests/luciStubs';

afterEach(() => setCoreFeatures(null));

describe('before the router has answered', () => {
  it('hides nothing, so the page offers what it always did', () => {
    expect(coreHas('quic')).toBe(true);
    expect(coreHas('tailscale')).toBe(true);
    expect(coreSupportsType('naive')).toBe(true);
    expect(linkCoreFeatures('hy2://p@example.com:443#h')).toEqual([]);
    expect(validateCoreFeature('api')).toBe(true);
    expect(coreFilterTypeChoices(groupTypeChoices(), [])).toEqual(
      groupTypeChoices(),
    );
  });

  it('keeps hiding nothing for a router without a core', () => {
    setCoreFeatures({ ...coreFeatures(), known: false });
    expect(coreHas('clash_api')).toBe(true);
  });
});

describe('the base build', () => {
  it('has what it was built with and lacks the rest', () => {
    setCoreFeatures(coreFeatures());
    expect(coreHas('quic')).toBe(true);
    expect(coreHas('wireguard')).toBe(true);
    expect(coreHas('tailscale')).toBe(false);
    expect(coreHas('api')).toBe(false);
  });

  it('looks a type up by the kind of object it is', () => {
    setCoreFeatures(coreFeatures());
    expect(coreFeatureOfType('warp')).toBe('wireguard');
    expect(coreSupportsType('naive')).toBe(false);
    expect(coreSupportsType('naive', ['inbound'])).toBe(true);
    expect(coreSupportsType('tailscale', ['endpoint'])).toBe(false);
    expect(coreSupportsType('vless')).toBe(true);
  });

  it('names only the tags the build lacks', () => {
    setCoreFeatures(coreFeatures());
    expect(missingCoreTags('tailscale')).toEqual(['with_tailscale']);
    expect(missingCoreFeatureNote('tailscale')).toBe(
      'the installed sing-box lacks with_tailscale',
    );
    expect(validateCoreFeature('api')).toBe(
      'The installed sing-box was built without with_api',
    );
    expect(validateCoreFeature('quic')).toBe(true);
    expect(validateCoreFeature('')).toBe(true);
  });
});

describe('a share link', () => {
  it.each(linkFeatureCases())('%s needs %j', (link, features) => {
    setCoreFeatures(coreFeatures());
    expect(linkCoreFeatures(link)).toEqual(features);
  });
});

describe('the runtime feed', () => {
  it('carries the report in, and a CLI answer without one leaves it', () => {
    const state = (core) => ({
      service: {
        forkop: { running: 1, enabled: 1, status: 'running', busy: null },
        sing_box: { running: 1, enabled: 1, status: 'running' },
      },
      capabilities: { server_inbounds_enabled_count: 0, core },
      actions: { service: [], component: [] },
    });

    applyUiStateToStore(state(coreFeatures({ remove: ['with_quic'] })));
    expect(coreHas('quic')).toBe(false);
    applyUiStateToStore(state());
    expect(coreHas('quic')).toBe(false);
    applyUiStateToStore(state(coreFeatures()));
    expect(coreHas('quic')).toBe(true);
  });
});

describe('the server types a filter offers', () => {
  it('are the ones the core can build, and the ones the filter already names', () => {
    setCoreFeatures(coreFeatures());
    const offered = coreFilterTypeChoices(providerTypeChoices(), ['naive']);

    expect(offered.map((choice) => choice.value)).toContain('hysteria2');
    expect(offered.find((choice) => choice.value === 'naive')?.label).toBe(
      'NaiveProxy (the installed sing-box lacks with_naive_outbound)',
    );
    const groupValues = coreFilterTypeChoices(groupTypeChoices(), []).map(
      (choice) => choice.value,
    );
    for (const missing of ['tailscale', 'openconnect', 'naive'])
      expect(groupValues).not.toContain(missing);
    expect(groupValues).toContain('wireguard');
  });
});

describe('what a section asks of the core', () => {
  it('is its tunnels and its links, and never its subscriptions', () => {
    setCoreFeatures(coreFeatures());
    installUciStub({
      sec: {
        '.type': 'section',
        selector_proxy_links: [
          'naive+https://u:p@example.com:443#n',
          'vless://u@example.com:443?security=reality&pbk=k#r',
        ],
      },
      tun: { '.type': 'tunnel', section: 'sec', kind: 'tailscale' },
      json: { '.type': 'tunnel', section: 'sec', kind: 'json' },
      sub: { '.type': 'subscription_url', section: 'sec', url: 'https://x' },
    });

    expect(sectionMissingCoreFeatures('sec').sort()).toEqual([
      'naive',
      'tailscale',
    ]);
  });
});
