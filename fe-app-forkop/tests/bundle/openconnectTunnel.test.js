// The OpenConnect tunnel, driven through the shipped bundle. A configuration
// imported into a new tunnel turns the dialog into an OpenConnect one with its
// fields filled, and what the dialog saves is the native endpoint the router
// hands the core.
import { beforeEach, describe, expect, it } from 'vitest';

import { coreFeatures } from '../lib/coreFeatures.js';
import { createHarness } from '../lib/luciForm.js';

let harness;

beforeEach(() => {
  harness = createHarness();
  harness.bundle.setCoreFeatures(coreFeatures({ add: ['with_openconnect'] }));
  harness.uci.add('forkop', 'section', 'sec');
  Object.assign(harness.store.get('sec'), {
    action: 'connection',
    enabled: '1',
    label: 'Work',
  });
});

const option = (section, name) =>
  section.children.find((child) => child.option === name);

const PIN = 'pin-sha256:svnty/laZqBAdkrdaiQxUb+x8kHPG7QJjSPRjA20WhU=';

async function openTunnel(itemValue, context = {}) {
  const map = new harness.form.Map('forkop');
  const sections = map.section(harness.form.GridSection, 'section');
  delete sections.load;
  harness.bundle.createSectionContent(sections);
  const dialog = await harness.openDialog(
    option(sections, 'tunnels'),
    'sec',
    itemValue,
    context,
  );
  const fields = dialog.map.children[0];
  const value = (name) =>
    dialog.map.data.get(dialog.map.config, 'settings', name);
  // What the widgets hold once the import has set them.
  const followWidgets = () =>
    fields.children.forEach((field) => {
      field.formvalue = (sid) =>
        dialog.map.data.get(dialog.map.config, sid, field.option) ?? null;
    });
  return {
    ...dialog,
    value,
    async importConfiguration(text) {
      const nested = await harness.openDialogWith(() =>
        option(fields, '_import_config').onclick(),
      );
      option(nested.map.children[0], 'configuration').formvalue = () => text;
      return nested.save();
    },
    async saveAsShown() {
      followWidgets();
      return dialog.save();
    },
  };
}

function storedTunnels() {
  return harness.uci.sections('forkop', 'tunnel').map((tunnel) => ({
    kind: tunnel.kind,
    name: tunnel.name,
    endpoint: JSON.parse(tunnel.endpoint_json || 'null'),
  }));
}

describe('an OpenConnect configuration imported into a new tunnel', () => {
  it('fills the dialog as OpenConnect and saves the endpoint it describes', async () => {
    const dialog = await openTunnel('', { adding: true });
    const imported = await dialog.importConfiguration(
      `openconnect --protocol=fortinet --user=alice --servercert ${PIN} vpn.example.com:10443/staff`,
    );
    expect(imported.saved).toBe(true);
    expect({
      kind: dialog.value('tunnel_type'),
      flavor: dialog.value('openconnect_flavor'),
      server: dialog.value('openconnect_server'),
      username: dialog.value('openconnect_username'),
      fingerprints: dialog.value('openconnect_fingerprints'),
    }).toEqual({
      kind: 'openconnect',
      flavor: 'fortinet',
      server: 'vpn.example.com:10443/staff',
      username: 'alice',
      fingerprints: [PIN],
    });

    expect((await dialog.saveAsShown()).saved).toBe(true);
    expect(storedTunnels()).toEqual([
      {
        kind: 'openconnect',
        name: expect.any(String),
        endpoint: {
          type: 'openconnect',
          server: 'vpn.example.com:10443/staff',
          flavor: 'fortinet',
          external_auth_disabled: true,
          username: 'alice',
          tls: { peer_fingerprint: [PIN] },
        },
      },
    ]);
  });

  it('stays open and says which file it needs', async () => {
    const dialog = await openTunnel('', { adding: true });
    const imported = await dialog.importConfiguration(
      'openconnect -c alice.pem -k alice.key vpn.example.com',
    );
    expect(imported.saved).toBe(false);
    expect(harness.toasts()).toContain(
      'The profile refers to the file alice.pem. Select it together with the profile',
    );
    expect(dialog.value('tunnel_type')).not.toBe('openconnect');
  });
});

describe('a stored OpenConnect tunnel', () => {
  it('opens with its fields and saves back as it was', async () => {
    const endpoint = {
      type: 'openconnect',
      server: 'vpn.example.com',
      flavor: 'anyconnect',
      external_auth_disabled: true,
      username: 'bob',
      password: 'secret',
      token: { mode: 'totp', secret: 'JBSWY3DPEHPK3PXP' },
      mobile: {
        platform_version: '17',
        device_type: 'iPhone',
        device_unique_id: 'x',
      },
    };
    harness.uci.add('forkop', 'tunnel', 'oc');
    Object.assign(harness.store.get('oc'), {
      section: 'sec',
      kind: 'openconnect',
      name: 'Office',
      endpoint_json: JSON.stringify(endpoint),
    });
    const dialog = await openTunnel('oc');
    expect(dialog.value('openconnect_token_mode')).toBe('totp');
    expect(dialog.value('openconnect_password')).toBe('secret');

    expect((await dialog.saveAsShown()).saved).toBe(true);
    expect(storedTunnels()).toEqual([
      { kind: 'openconnect', name: 'Office', endpoint },
    ]);
  });
});
