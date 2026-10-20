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

async function pressGenerate() {
  const map = new harness.form.Map('forkop');
  const sections = map.section(harness.form.GridSection, 'section');
  delete sections.load;
  harness.bundle.createSectionContent(sections);
  const dialog = await harness.openDialog(
    option(sections, 'tunnels'),
    'sec',
    '',
    { adding: true },
  );
  await option(dialog.map.children[0], '_generate_warp_profile').onclick();
  const value = (name) =>
    dialog.map.data.get(dialog.map.config, 'settings', name);
  return {
    id: value('warp_profile_id'),
    token: value('warp_auth_token'),
    key: value('warp_private_key'),
  };
}

describe('the WARP profile button', () => {
  it('fills the profile the router generated', async () => {
    harness.commands.generate_warp_profile = () =>
      Promise.resolve({
        code: 0,
        stdout: JSON.stringify({
          id: 'profile-id',
          auth_token: 'auth-token',
          private_key: 'private-key',
        }),
      });

    expect(await pressGenerate()).toEqual({
      id: 'profile-id',
      token: 'auth-token',
      key: 'private-key',
    });
    expect(harness.notifications).toEqual([]);
  });

  it('leaves a refused generation to the alert its log line raises', async () => {
    harness.commands.generate_warp_profile = () =>
      Promise.resolve({
        code: 1,
        stdout: '',
        stderr:
          'Failed to generate WARP profile: net/http: TLS handshake timeout\n',
      });

    const filled = await pressGenerate();

    expect(harness.notifications).toEqual([]);
    expect(filled.id ?? '').toBe('');
  });

  it('says why when the call never reached the router', async () => {
    harness.commands.generate_warp_profile = () =>
      Promise.reject(new Error('XHR request timed out'));

    await pressGenerate();

    expect(harness.notifications).toEqual([
      { title: 'Forkop Error', text: 'XHR request timed out', kind: 'error' },
    ]);
  });
});
