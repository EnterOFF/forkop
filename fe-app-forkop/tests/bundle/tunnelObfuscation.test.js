// The traffic obfuscation switch of the tunnel dialog, driven through the
// shipped bundle. A WireGuard and a WARP tunnel send the one-sided AmneziaWG
// parameters only while it is on, so what a change of kind leaves it at decides
// which of the values in the dialog are kept.
import { beforeEach, describe, expect, it } from 'vitest';

import { coreFeatures } from '../lib/coreFeatures.js';
import { createHarness } from '../lib/luciForm.js';

let harness;

beforeEach(() => {
  harness = createHarness();
  harness.bundle.setCoreFeatures(coreFeatures());
  harness.uci.add('forkop', 'section', 'sec');
  Object.assign(harness.store.get('sec'), {
    action: 'connection',
    enabled: '1',
    label: 'Home',
  });
});

const option = (section, name) =>
  section.children.find((child) => child.option === name);

async function openTunnel(tunnel) {
  harness.uci.add('forkop', 'tunnel', 'tun');
  Object.assign(harness.store.get('tun'), { section: 'sec', ...tunnel });
  const map = new harness.form.Map('forkop');
  const sections = map.section(harness.form.GridSection, 'section');
  delete sections.load;
  harness.bundle.createSectionContent(sections);
  const dialog = await harness.openDialog(
    option(sections, 'tunnels'),
    'sec',
    'tun',
  );
  const fields = dialog.map.children[0];
  return {
    switchTo(kind) {
      option(fields, 'tunnel_type').onchange(null, 'settings', kind);
    },
    value: (name) => dialog.map.data.get(dialog.map.config, 'settings', name),
  };
}

const AMNEZIAWG = {
  kind: 'amneziawg',
  name: 'Amnezia',
  address: ['10.0.0.2/32'],
  private_key: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
  amnezia_s1: '12',
  amnezia_h1: '100-200',
};

describe('the traffic obfuscation switch', () => {
  it('is on for a stored tunnel that carries a one-sided parameter', async () => {
    for (const kind of ['wireguard', 'warp']) {
      harness = createHarness();
      harness.bundle.setCoreFeatures(coreFeatures());
      harness.uci.add('forkop', 'section', 'sec');
      const dialog = await openTunnel({ kind, name: kind, amnezia_jc: '5' });
      expect(dialog.value('amnezia_enabled'), kind).toBe('1');
    }
  });

  it.each(['wireguard', 'warp'])(
    'turns on for %s when the AmneziaWG tunnel had a one-sided parameter',
    async (kind) => {
      const dialog = await openTunnel({ ...AMNEZIAWG, amnezia_jc: '5' });
      dialog.switchTo(kind);
      expect(dialog.value('amnezia_enabled')).toBe('1');
    },
  );

  it.each(['wireguard', 'warp'])(
    'stays off for %s when the AmneziaWG tunnel had only parameters both ends match',
    async (kind) => {
      const dialog = await openTunnel(AMNEZIAWG);
      dialog.switchTo(kind);
      expect(dialog.value('amnezia_enabled')).toBe('0');
    },
  );

  it('carries over between WireGuard and WARP as it is', async () => {
    const dialog = await openTunnel({
      kind: 'wireguard',
      name: 'Plain',
      amnezia_jc: '5',
    });
    dialog.switchTo('warp');
    expect(dialog.value('amnezia_enabled')).toBe('1');
  });
});
