#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ROOT_DIR="$ROOT_DIR" node - <<'NODE'
const path = require('path');

const root = process.env.ROOT_DIR;
const { createHarness } = require(path.join(root, 'tests/helpers/luci_form.js'));

const problems = [];
function fail(message) {
  problems.push(message);
}

const WG_KEY = 'zz5/p+jwYqPFlg9mWcOP5ad8xXa4XfOOlrzouVD6E1w=';
const WG_PUB = 'AKR8dq2b9o7/cO8d5mAzxvuxRhhw4DXi1pfUC3IPGWo=';
const ALL_PROVIDERS = {
  zapretInstalled: true,
  zapret2Installed: true,
  byedpiInstalled: true,
};

function addSections(harness, list) {
  list.forEach(([type, sid, values]) => {
    harness.uci.add('forkop', type, sid);
    Object.assign(harness.store.get(sid), values);
  });
  harness.operations.length = 0;
}

function sectionGrid(harness, providers = ALL_PROVIDERS) {
  const view = harness.bundle;
  const map = new harness.form.Map('forkop');
  const grid = map.section(harness.form.GridSection, 'section');
  view.configureSectionSection(grid, {
    loadActionProvidersAvailability: () => Promise.resolve(providers),
  });
  // configureSectionSection installs the table's load(), which skips the
  // modal-only options; the dialog under test loads all of them.
  delete grid.load;
  view.createSectionContent(grid);
  return grid;
}

function serverGrid(harness) {
  const view = harness.bundle;
  const map = new harness.form.Map('forkop');
  const grid = map.section(harness.form.GridSection, 'server');
  view.createServerContent(grid);
  return grid;
}

// Saving a LuCI modal parses one option at a time, so a rejection halfway leaves
// what the earlier options wrote. Errors are collected rather than thrown for
// that reason: what matters is what reached the configuration, not that the save
// was refused.
async function saveSection(grid, sid) {
  grid.cfgsections = () => [sid];
  await grid.load();
  const rejects = [];
  for (const option of grid.children) {
    try {
      await option.parse(sid);
    } catch (error) {
      rejects.push(option.option);
    }
  }
  return rejects;
}

function itemsOfType(harness, type) {
  return harness.uci
    .sections('forkop', type)
    .map((item) => item['.name'])
    .sort();
}

/* ------------------------------------------------------------------ fixtures */

const CONNECTION_SECTION = [
  'section',
  'sec',
  {
    action: 'connection',
    enabled: '1',
    label: 'proxy',
    domain: 'example.com',
    outbound_detour_enabled: '0',
    selector_proxy_links: ['vless://a@example:1?type=tcp#node'],
    outbound_jsons: ['{"type":"socks","tag":"local","server":"127.0.0.1","server_port":1080}'],
  },
];

function connectionChildren() {
  return [
    CONNECTION_SECTION,
    ['subscription_url', 'sub1', {
      section: 'sec',
      url: 'https://example.com/sub',
      tag: 'sub1',
      show_subscription_name: '0',
      server_filter_mode: 'all',
      subscription_update_enabled: '1',
      subscription_update_interval: '1h',
      download_via_proxy_enabled: '0',
      show_dashboard_metadata: '1',
    }],
    ['section_interface', 'iface1', {
      section: 'sec',
      name: 'wan',
      display_name: 'WAN',
      domain_resolver_enabled: '0',
    }],
    ['tunnel', 'tun1', {
      section: 'sec',
      kind: 'wireguard',
      name: 'wg',
      order: '0',
      private_key: WG_KEY,
      address: ['10.8.1.9/32'],
    }],
    ['tunnel_peer', 'peer1', {
      tunnel: 'tun1',
      order: '0',
      address: 'peer.example',
      port: '47132',
      public_key: WG_PUB,
      allowed_ips: ['0.0.0.0/0'],
    }],
    ['urltest', 'ut1', {
      section: 'sec',
      name: 'URLTest #1',
      check_interval: '3m',
      tolerance: '50',
      testing_url: 'https://www.gstatic.com/generate_204',
      expected_status: '*',
      idle_timeout: '30m',
      interrupt_exist_connections: '0',
      hide_dashboard_members: '0',
      server_filter_mode: 'all',
    }],
    ['fallback_group', 'grp1', {
      section: 'sec',
      name: 'Fallback #1',
      health_check_url: 'https://www.gstatic.com/generate_204',
      health_check_interval: '5m',
      health_check_timeout: '5s',
      attempt_timeout: '5s',
      expected_status: '*',
      idle_timeout: '5m',
      interrupt_exist_connections: '0',
      hide_dashboard_members: '0',
    }],
    ['fallback_level', 'lvl1', {
      group: 'grp1',
      name: 'Group #1',
      order: '0',
      server_filter_mode: 'direct',
    }],
  ];
}

const CHILD_TYPES = [
  'subscription_url',
  'section_interface',
  'tunnel',
  'tunnel_peer',
  'urltest',
  'fallback_group',
  'fallback_level',
];

function survivingChildren(harness) {
  return CHILD_TYPES.flatMap((type) => itemsOfType(harness, type)).sort();
}

const MIXED_SERVER = [
  'server',
  'srv',
  {
    protocol: 'mixed',
    enabled: '1',
    label: 'Server #1',
    listen: '0.0.0.0',
    listen_port: '1080',
    public_host: '192.168.1.1',
    open_firewall: '1',
    mixed_auth_enabled: '1',
    routing_mode: 'rules',
    security: 'none',
  },
];
const SERVER_ACCOUNT = [
  'server_client',
  'cl1',
  { server: 'srv', name: 'client-1', password: 'Ux-2LP-vrTXCc1wxJt5QUUvK' },
];

/* ----------------------------------------------- a list nobody could see */

// Everything a child item holds is something the user cannot type again: an
// account password every device is configured with, a tunnel private key, a
// subscription URL. A list the dialog hides was not cleared by anybody, so the
// items behind it have to stay.
async function checkHiddenListsKeepTheirItems() {
  for (const action of ['bypass', 'block', 'dns', 'zapret']) {
    const harness = createHarness(root);
    addSections(harness, connectionChildren());
    const grid = sectionGrid(harness);
    grid.cfgsections = () => ['sec'];
    await grid.load();
    // The dropdown holds the new action while the stored one is still the old:
    // the action option reads uci in cfgvalue(), so the widget is what decides.
    grid.children.find((option) => option.option === 'action').formvalue = () => action;
    for (const option of grid.children) {
      await Promise.resolve()
        .then(() => option.parse('sec'))
        .catch(() => {});
    }
    const left = survivingChildren(harness);
    const expected = ['grp1', 'iface1', 'lvl1', 'peer1', 'sub1', 'tun1', 'ut1'];
    if (`${left}` !== `${expected}`) {
      fail(
        `changing a section from Connection to ${action} took its children with it: ` +
          `${left.join(', ') || '(nothing left)'}`,
      );
    }
    // The two sources a section holds itself, next to the four it holds as child
    // sections: pasted server URIs and hand-written outbound objects.
    for (const option of ['selector_proxy_links', 'outbound_jsons']) {
      if (!harness.uci.get('forkop', 'sec', option)) {
        fail(`changing a section from Connection to ${action} dropped its ${option}`);
      }
    }
  }

  for (const [label, seed] of [
    ['switching the protocol to tailscale', { protocol: 'tailscale' }],
    ['switching the protocol to json_inbound', { protocol: 'json_inbound' }],
    ['turning the authentication switch off', { mixed_auth_enabled: '0' }],
  ]) {
    const harness = createHarness(root);
    addSections(harness, [MIXED_SERVER, SERVER_ACCOUNT]);
    const grid = serverGrid(harness);
    grid.cfgsections = () => ['srv'];
    await grid.load();
    Object.entries(seed).forEach(([name, value]) => {
      grid.children.find((option) => option.option === name).formvalue = () => value;
    });
    for (const option of grid.children) {
      await Promise.resolve()
        .then(() => option.parse('srv'))
        .catch(() => {});
    }
    if (!itemsOfType(harness, 'server_client').length) {
      fail(`${label} deleted the accounts of the server`);
    }
  }
}

// The other half of the same rule: a list the user can see still owns its items.
async function checkVisibleListsStillOwnTheirItems() {
  {
    const harness = createHarness(root);
    addSections(harness, connectionChildren());
    const grid = sectionGrid(harness);
    grid.cfgsections = () => ['sec'];
    await grid.load();
    grid.children.find((option) => option.option === 'tunnels').formvalue = () => [];
    for (const option of grid.children) {
      await Promise.resolve()
        .then(() => option.parse('sec'))
        .catch(() => {});
    }
    if (itemsOfType(harness, 'tunnel').length || itemsOfType(harness, 'tunnel_peer').length) {
      fail('clearing the tunnel list left the tunnel behind');
    }
    if (!itemsOfType(harness, 'subscription_url').length) {
      fail('clearing the tunnel list took the subscriptions with it');
    }
  }

  {
    const harness = createHarness(root);
    addSections(harness, connectionChildren());
    harness.uci.add('forkop', 'tunnel', 'tun2');
    Object.assign(harness.store.get('tun2'), {
      section: 'sec',
      kind: 'wireguard',
      name: 'wg2',
      order: '1',
      private_key: WG_KEY,
      address: ['10.8.1.10/32'],
    });
    const grid = sectionGrid(harness);
    grid.cfgsections = () => ['sec'];
    await grid.load();
    grid.children.find((option) => option.option === 'tunnels').formvalue = () => ['tun1'];
    for (const option of grid.children) {
      await Promise.resolve()
        .then(() => option.parse('sec'))
        .catch(() => {});
    }
    if (`${itemsOfType(harness, 'tunnel')}` !== 'tun1') {
      fail(
        `removing one tunnel from the list did not remove exactly that one: ` +
          `${itemsOfType(harness, 'tunnel').join(', ')}`,
      );
    }
  }

  {
    const harness = createHarness(root);
    addSections(harness, connectionChildren());
    const grid = sectionGrid(harness);
    grid.handleRemove = () => Promise.resolve();
    grid.cfgsections = () => ['sec'];
    await grid.load();
    await grid.handleRemove('sec');
    if (survivingChildren(harness).length !== 7) {
      fail('the section removal hook stopped cleaning up the children');
    }
  }
}

// Deleting a server still takes its accounts, and deleting a section still takes
// everything under it - both are explicit hooks, not a side effect of a hidden
// field.
async function checkRemovingAnOwnerTakesItsChildren() {
  {
    const harness = createHarness(root);
    addSections(harness, [MIXED_SERVER, SERVER_ACCOUNT]);
    const grid = serverGrid(harness);
    const view = harness.bundle;
    view.configureServerSection(grid);
    grid.cfgsections = () => ['srv'];
    grid.map.data.remove = () => {};
    await grid.load();
    await Promise.resolve()
      .then(() => grid.handleRemove('srv'))
      .catch(() => {});
    if (itemsOfType(harness, 'server_client').length) {
      fail('deleting a server left its accounts behind');
    }
  }

  {
    const harness = createHarness(root);
    addSections(harness, connectionChildren());
    const grid = sectionGrid(harness);
    grid.handleRemove = () => Promise.resolve();
    const view = harness.bundle;
    view.configureSectionSection(grid, {
      loadActionProvidersAvailability: () => Promise.resolve(ALL_PROVIDERS),
    });
    await grid.handleRemove('sec');
    const left = survivingChildren(harness);
    if (left.length) {
      fail(`deleting a section left its children behind: ${left.join(', ')}`);
    }
  }
}

/* -------------------------------------- a value the dropdown cannot show */

// A <select> hands back one of its own entries and nothing else, so a stored name
// the list has no entry for is replaced by whichever entry comes first. Every
// option below names another section, and every one of them can outlive its
// target: the target can be deleted, switched off, or belong to a DPI provider
// that is not installed.
async function checkSectionReferencesSurvive() {
  const liveSection = [
    'section',
    'live',
    {
      action: 'connection',
      enabled: '1',
      label: 'Live',
      selector_proxy_links: ['vless://y@example:1#n'],
    },
  ];
  const target = (enabled) => [
    'section',
    'target',
    {
      action: 'connection',
      enabled,
      label: 'Target',
      selector_proxy_links: ['vless://x@example:1#n'],
    },
  ];
  const states = [
    ['its target was deleted', []],
    ['its target is switched off', [target('0')]],
  ];

  for (const [label, extra] of states) {
    {
      const harness = createHarness(root);
      addSections(harness, [
        ['section', 'sec', {
          action: 'dns',
          enabled: '1',
          label: 'DNS section',
          dns_server: ['tls://1.1.1.1'],
          domain: 'example.com',
          dns_detour_enabled: '1',
          dns_detour_section: 'target',
        }],
        liveSection,
        ...extra,
      ]);
      await saveSection(sectionGrid(harness), 'sec');
      if (harness.uci.get('forkop', 'sec', 'dns_detour_section') !== 'target') {
        fail(`dns_detour_section was pointed at another section when ${label}`);
      }
    }

    {
      const harness = createHarness(root);
      addSections(harness, [
        ['section', 'sec', {
          action: 'connection',
          enabled: '1',
          label: 'Section',
          selector_proxy_links: ['vless://z@example:1#n'],
          outbound_detour_enabled: '1',
          outbound_detour_section: 'target',
        }],
        liveSection,
        ...extra,
      ]);
      await saveSection(sectionGrid(harness), 'sec');
      if (harness.uci.get('forkop', 'sec', 'outbound_detour_section') !== 'target') {
        fail(`outbound_detour_section was pointed at another section when ${label}`);
      }
    }

    {
      const harness = createHarness(root);
      addSections(harness, [
        ['server', 'srv', {
          ...MIXED_SERVER[2],
          routing_mode: 'section',
          routing_section: 'target',
        }],
        SERVER_ACCOUNT,
        liveSection,
        ...extra,
      ]);
      await saveSection(serverGrid(harness), 'srv');
      if (harness.uci.get('forkop', 'srv', 'routing_section') !== 'target') {
        fail(`a server routing_section was pointed at another section when ${label}`);
      }
    }

    {
      const harness = createHarness(root);
      addSections(harness, [
        ['server', 'srv', {
          protocol: 'tailscale',
          enabled: '1',
          label: 'Server #1',
          routing_mode: 'rules',
          security: 'none',
          tailscale_auth_key: 'tskey',
          tailscale_hostname: 'router',
          tailscale_control_url: 'https://controlplane.tailscale.com',
          tailscale_detour_enabled: '1',
          tailscale_detour_section: 'target',
        }],
        liveSection,
        ...extra,
      ]);
      await saveSection(serverGrid(harness), 'srv');
      if (harness.uci.get('forkop', 'srv', 'tailscale_detour_section') !== 'target') {
        fail(
          `a server tailscale_detour_section was pointed at another section when ${label}`,
        );
      }
    }

    {
      const harness = createHarness(root);
      const view = harness.bundle;
      addSections(harness, [
        ['settings', 'settings', {
          dns_server: ['tls://1.1.1.1'],
          bootstrap_dns_server: ['1.1.1.1'],
          dns_detour_enabled: '1',
          dns_detour_section: 'target',
          download_lists_via_proxy: '1',
          download_lists_via_proxy_section: 'target',
          download_components_via_proxy: '1',
          download_components_via_proxy_section: 'target',
        }],
        liveSection,
        ...extra,
      ]);
      const map = new harness.form.Map('forkop');
      const settingsSection = map.section(harness.form.NamedSection, 'settings');
      view.createSettingsContent(settingsSection, { loaded: true, ...ALL_PROVIDERS });
      await saveSection(settingsSection, 'settings');
      for (const name of [
        'dns_detour_section',
        'download_lists_via_proxy_section',
        'download_components_via_proxy_section',
      ]) {
        if (harness.uci.get('forkop', 'settings', name) !== 'target') {
          fail(`the Settings page pointed ${name} at another section when ${label}`);
        }
      }
    }

    for (const [type, listName, seed, key] of [
      [
        'subscription_url',
        'subscription_url',
        {
          url: 'https://example.com/sub',
          tag: 'sub1',
          show_subscription_name: '0',
          server_filter_mode: 'all',
          subscription_update_enabled: '1',
          subscription_update_interval: '1h',
          download_via_proxy_enabled: '1',
          download_via_proxy_section: 'target',
          show_dashboard_metadata: '1',
        },
        'download_via_proxy_section',
      ],
      [
        'section_interface',
        'interfaces',
        {
          name: 'wan',
          display_name: 'WAN',
          domain_resolver_enabled: '1',
          domain_resolver_dns_server: ['tls://1.1.1.1'],
          domain_resolver_dns_detour_enabled: '1',
          domain_resolver_dns_detour_section: 'target',
        },
        'domain_resolver_dns_detour_section',
      ],
      [
        'tunnel',
        'tunnels',
        {
          kind: 'tailscale',
          name: 'ts',
          order: '0',
          tailscale_auth_key: 'tskey',
          tailscale_hostname: 'router',
          tailscale_exit_node: 'exit-node',
          tailscale_control_url: 'https://controlplane.tailscale.com',
          tailscale_detour_enabled: '1',
          tailscale_detour_section: 'target',
        },
        'tailscale_detour_section',
      ],
    ]) {
      const harness = createHarness(root);
      addSections(harness, [
        ['section', 'owner', {
          action: 'connection',
          enabled: '1',
          label: 'Owner',
          selector_proxy_links: ['vless://o@example:1#n'],
        }],
        [type, 'item', { section: 'owner', ...seed }],
        liveSection,
        ...extra,
      ]);
      const grid = sectionGrid(harness);
      const list = grid.children.find((option) => option.option === listName);
      const dialog = await harness.openDialog(list, 'owner', 'item');
      const result = await dialog.save().catch(() => ({ saved: false }));
      if (!result.saved) {
        fail(`the ${type} dialog refused to save while ${label}`);
        continue;
      }
      if (harness.uci.get('forkop', 'item', key) !== 'target') {
        fail(`${type}.${key} was pointed at another section when ${label}`);
      }
    }
  }

  // A DNS detour may point at a DPI section, and the list of DPI sections shrinks
  // when the provider is gone.
  const harness = createHarness(root);
  addSections(harness, [
    ['section', 'sec', {
      action: 'dns',
      enabled: '1',
      label: 'DNS section',
      dns_server: ['tls://1.1.1.1'],
      domain: 'example.com',
      dns_detour_enabled: '1',
      dns_detour_section: 'target',
    }],
    liveSection,
    ['section', 'target', {
      action: 'zapret',
      enabled: '1',
      label: 'Target',
      nfqws_opt: '--dpi-desync=fake',
      domain: 'example.com',
    }],
  ]);
  await saveSection(
    sectionGrid(harness, {
      zapretInstalled: false,
      zapret2Installed: false,
      byedpiInstalled: false,
    }),
    'sec',
  );
  if (harness.uci.get('forkop', 'sec', 'dns_detour_section') !== 'target') {
    fail(
      'dns_detour_section was pointed at another section because the target needs a provider that is not installed',
    );
  }
}

// The provider a DPI section needs can be missing - uninstalled, or an answer
// that did not arrive - and the action list is built from what is installed. The
// section still works: the configuration check leaves a rule whose provider is
// absent alone. Its action must survive a save that never showed the choice.
async function checkDpiActionSurvivesAMissingProvider() {
  for (const [action, field] of [
    ['zapret', 'nfqws_opt'],
    ['zapret2', 'nfqws2_opt'],
    ['byedpi', 'byedpi_cmd_opts'],
  ]) {
    const harness = createHarness(root);
    addSections(harness, [
      ['section', 'sec', {
        action,
        enabled: '1',
        label: 'DPI section',
        domain: 'example.com',
        [field]: action === 'byedpi' ? '-Kt,h' : '--dpi-desync=fake',
      }],
    ]);
    await saveSection(
      sectionGrid(harness, {
        zapretInstalled: false,
        zapret2Installed: false,
        byedpiInstalled: false,
      }),
      'sec',
    );
    const stored = harness.uci.get('forkop', 'sec', 'action');
    if (stored !== action) {
      fail(
        `saving a ${action} section while its provider is not installed turned it into a '${stored}' section`,
      );
    }
    if (!harness.uci.get('forkop', 'sec', field)) {
      fail(`saving a ${action} section while its provider is not installed dropped its strategy`);
    }
  }
}

/* ---------------------------------------- what a creation default writes */

// A default written when an item is added has to be an option something reads.
// user_agent was moved into the ordinary headers and a migration deletes it, so
// writing it again gives every new subscription a dead option that nothing will
// ever clear.
async function checkSubscriptionDefaultsAreLive() {
  const harness = createHarness(root);
  addSections(harness, [CONNECTION_SECTION]);
  const grid = sectionGrid(harness);
  grid.cfgsections = () => ['sec'];
  await grid.load();
  const list = grid.children.find((option) => option.option === 'subscription_url');
  list.formvalue = () => ['https://example.com/new'];
  await Promise.resolve()
    .then(() => list.parse('sec'))
    .catch(() => {});
  const added = harness.uci
    .sections('forkop', 'subscription_url')
    .find((item) => item.url === 'https://example.com/new');
  if (!added) {
    fail('adding a subscription url did not create a subscription section');
    return;
  }
  if (added.user_agent !== undefined) {
    fail('adding a subscription still writes the user_agent option no reader has left');
  }
}

(async () => {
  await checkHiddenListsKeepTheirItems();
  await checkVisibleListsStillOwnTheirItems();
  await checkRemovingAnOwnerTakesItsChildren();
  await checkSectionReferencesSurvive();
  await checkDpiActionSurvivesAMissingProvider();
  await checkSubscriptionDefaultsAreLive();
  if (problems.length) {
    problems.forEach((problem) => console.error(`FAIL: ${problem}`));
    process.exit(1);
  }
  console.log('LuCI option lifecycle checks passed');
})().catch((error) => {
  console.error(`FAIL: ${error && error.stack}`);
  process.exit(1);
});
NODE
