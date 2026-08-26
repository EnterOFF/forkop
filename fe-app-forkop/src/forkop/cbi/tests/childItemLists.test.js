import { beforeEach, describe, expect, it } from 'vitest';

import {
  createFormSectionStub,
  installLuciStubs,
} from '../../../helpers/tests/luciStubs';
import { createSectionContent } from '../../tabs/sections';
import { addClientListOption } from '../../tabs/servers/form/clients';
import { childPendingSettingsStore } from '../itemSettings';

// What every child item list answers about one of its entries.
//
// Six lists across two tabs store their entries as uci sections of their own: a
// subscription, a network interface, a URLTest group, a fallback group, the
// levels inside one, and a server's clients. The list shows a name and stores a
// section id, and until the parent dialog is saved an entry may be neither - a
// draft whose settings are held in memory under the text the user typed.
//
// The questions below are what the widget asks an option about an entry, and all
// six have to answer them the same way or an entry loses the settings its dialog
// took: what has this entry's dialog staged for it, does it have a dialog at
// all, and - for a list that shows a name - what name.

const SECTIONS = {
  vpn: { '.type': 'section', label: 'VPN', action: 'connection' },
  sub_stored: {
    '.type': 'subscription_url',
    section: 'vpn',
    url: 'https://example.com/list',
    tag: 'sub1',
  },
  iface_stored: {
    '.type': 'section_interface',
    section: 'vpn',
    name: 'eth1',
    display_name: 'Uplink',
  },
  urltest_stored: { '.type': 'urltest', section: 'vpn', name: 'Fastest' },
  group_stored: { '.type': 'fallback_group', section: 'vpn', name: 'Backup' },
  srv: { '.type': 'server', label: 'Home', protocol: 'vless' },
  client_stored: { '.type': 'server_client', server: 'srv', name: 'Laptop' },
};

function optionNamed(build, name) {
  const section = createFormSectionStub();
  build(section);
  const found = section.options.find((option) => option.name === name);
  expect(found, `no option named ${name}`).toBeTruthy();
  return found;
}

function listOption(name) {
  return name === 'clients'
    ? optionNamed(addClientListOption, name)
    : optionNamed(createSectionContent, name);
}

function hasDialog(option, owner, value) {
  return option.hasItemSettings(owner, value);
}

// Each list, with the entry a saved one is, the text that entry shows, and the
// section that owns it.
const LISTS = [
  ['subscription_url', 'sub_stored', 'https://example.com/list', 'vpn'],
  ['interfaces', 'iface_stored', 'eth1', 'vpn'],
  ['urltest', 'urltest_stored', 'Fastest', 'vpn'],
  ['fallback_group', 'group_stored', 'Backup', 'vpn'],
  ['clients', 'client_stored', 'Laptop', 'srv'],
];

describe('child item lists', () => {
  beforeEach(() => {
    installLuciStubs(SECTIONS);
  });

  // A saved entry is a child section id and its settings live in that section,
  // so the staged store is keyed by what the entry shows, not by the id.
  //
  // fallback_group is left out: its dialog writes the section as it is saved
  // rather than staging anything, so nothing ever asks it this.
  it.each(LISTS.filter(([name]) => name !== 'fallback_group'))(
    '%s finds staged settings under what a saved entry shows',
    (name, itemId, shown, owner) => {
      const option = listOption(name);
      childPendingSettingsStore(option, owner)[shown] = { staged: 'yes' };

      expect(option.stagedChildSettings(owner, itemId)).toEqual({
        staged: 'yes',
      });
    },
  );

  it.each(LISTS)(
    '%s offers a dialog for a saved entry',
    (name, itemId, _shown, owner) => {
      expect(hasDialog(listOption(name), owner, itemId)).toBe(true);
    },
  );

  // A draft entry has no section yet, so it is looked up by the text it shows
  // and the settings its dialog took come back with it.
  it.each([
    ['urltest', 'vpn'],
    ['clients', 'srv'],
  ])('%s hands a draft entry the settings its dialog took', (name, owner) => {
    const option = listOption(name);
    childPendingSettingsStore(option, owner).Draft = {
      name: 'Draft',
      staged: 'yes',
    };

    expect(option.stagedChildSettings(owner, 'Draft')).toEqual({
      name: 'Draft',
      staged: 'yes',
    });
    expect(hasDialog(option, owner, 'Draft')).toBe(true);
  });

  // A list that shows a name shows the one the dialog is holding, so an entry
  // renamed before the parent is saved is listed under the new name.
  it.each([
    ['urltest', 'vpn'],
    ['clients', 'srv'],
  ])('%s shows the name a draft dialog holds', (name, owner) => {
    const option = listOption(name);
    childPendingSettingsStore(option, owner).Renamed = { name: 'Renamed' };

    expect(option.inputValueForItem(owner, 'Renamed')).toBe('Renamed');
  });

  it.each([
    ['urltest', 'urltest_stored', 'Fastest', 'vpn'],
    ['clients', 'client_stored', 'Laptop', 'srv'],
  ])(
    '%s shows the stored name of a saved entry',
    (name, itemId, shown, owner) => {
      expect(listOption(name).inputValueForItem(owner, itemId)).toBe(shown);
    },
  );

  // A half-typed subscription is not an address yet, so it has nothing to
  // configure; every other list takes any entry the user has started.
  it('offers no dialog for a subscription that is not an address', () => {
    const option = listOption('subscription_url');

    expect(hasDialog(option, 'vpn', 'https://example.com/other')).toBe(true);
    expect(hasDialog(option, 'vpn', 'not a url')).toBe(false);
  });

  it.each([
    ['urltest', 'vpn'],
    ['fallback_group', 'vpn'],
    ['clients', 'srv'],
  ])('%s offers no dialog for an entry with no text', (name, owner) => {
    expect(hasDialog(listOption(name), owner, '')).toBe(false);
  });

  // A tunnel stores no display value on its child - an entry is the section id
  // itself - so it must not start answering with the name of a staged dialog,
  // which would make two tunnels of the same name look like one entry.
  it('keeps a tunnel entry addressed by its section id', () => {
    const option = listOption('tunnels');
    childPendingSettingsStore(option, 'vpn').tunnel_abc = { name: 'Office' };

    expect(option.inputValueForItem('vpn', 'tunnel_abc')).toBe('tunnel_abc');
  });

  // Writing the list drops what the dialogs staged, so a second save does not
  // re-apply settings to sections that already carry them.
  it.each([
    ['subscription_url', 'vpn'],
    ['interfaces', 'vpn'],
    ['urltest', 'vpn'],
    ['clients', 'srv'],
  ])('%s forgets what it staged once the list is written', (name, owner) => {
    const option = listOption(name);
    childPendingSettingsStore(option, owner).Draft = { name: 'Draft' };

    option.clearStagedChildSettings(owner);

    expect(childPendingSettingsStore(option, owner)).toEqual({});
  });
});
