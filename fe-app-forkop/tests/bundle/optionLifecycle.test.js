// What a dialog writes, and what it takes away, driven through the shipped
// bundle's own option set.
//
// Everything a child item holds is something the user cannot type again: an
// account password every device is configured with, a tunnel private key, a
// subscription URL. So the rule has two halves - a list the dialog hides was
// not cleared by anybody and its items must stay; a list the user can see still
// owns its items - and both are exercised here as a save, not as a grep.
import { beforeEach, describe, expect, it } from 'vitest';

import { createHarness } from '../lib/luciForm.js';

const WG_KEY = 'zz5/p+jwYqPFlg9mWcOP5ad8xXa4XfOOlrzouVD6E1w=';
const WG_PUB = 'AKR8dq2b9o7/cO8d5mAzxvuxRhhw4DXi1pfUC3IPGWo=';
const ALL_PROVIDERS = {
  zapretInstalled: true,
  zapret2Installed: true,
  byedpiInstalled: true,
};
const NO_PROVIDERS = {
  zapretInstalled: false,
  zapret2Installed: false,
  byedpiInstalled: false,
};

let harness;

beforeEach(() => {
  harness = createHarness();
});

function addSections(list) {
  list.forEach(([type, sid, values]) => {
    harness.uci.add('forkop', type, sid);
    Object.assign(harness.store.get(sid), values);
  });
  harness.operations.length = 0;
}

function sectionGrid(providers = ALL_PROVIDERS) {
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

function serverGrid() {
  const view = harness.bundle;
  const map = new harness.form.Map('forkop');
  const grid = map.section(harness.form.GridSection, 'server');
  view.createServerContent(grid);
  return grid;
}

// Saving a LuCI modal parses one option at a time, so a rejection halfway leaves
// what the earlier options wrote. Rejections are swallowed for that reason: what
// matters is what reached the configuration, not that the save was refused.
async function parseEveryOption(grid, sid) {
  grid.cfgsections = () => [sid];
  await grid.load();
  for (const option of grid.children) {
    await Promise.resolve()
      .then(() => option.parse(sid))
      .catch(() => {});
  }
}

function widgetAnswers(grid, values) {
  Object.entries(values).forEach(([name, value]) => {
    grid.children.find((option) => option.option === name).formvalue = () =>
      value;
  });
}

function itemsOfType(type) {
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
    destinations: 'example.com',
    outbound_jsons: [
      '{"type":"socks","tag":"local","server":"127.0.0.1","server_port":1080}',
    ],
  },
];

function connectionChildren() {
  return [
    CONNECTION_SECTION,
    [
      'connection_link',
      'link1',
      {
        section: 'sec',
        uri: 'vless://a@example:1?type=tcp#node',
        name: 'node',
        order: '0',
      },
    ],
    [
      'subscription_url',
      'sub1',
      {
        section: 'sec',
        url: 'https://example.com/sub',
        tag: 'sub1',
        server_filter_mode: 'all',
        subscription_update_enabled: '1',
        subscription_update_interval: '1h',
        download_via_proxy_enabled: '0',
        show_dashboard_metadata: '1',
      },
    ],
    [
      'section_interface',
      'iface1',
      {
        section: 'sec',
        name: 'wan',
        display_name: 'WAN',
        domain_resolver_enabled: '0',
      },
    ],
    [
      'tunnel',
      'tun1',
      {
        section: 'sec',
        kind: 'wireguard',
        name: 'wg',
        order: '0',
        private_key: WG_KEY,
        address: ['10.8.1.9/32'],
      },
    ],
    [
      'tunnel_peer',
      'peer1',
      {
        tunnel: 'tun1',
        order: '0',
        address: 'peer.example',
        port: '47132',
        public_key: WG_PUB,
        allowed_ips: ['0.0.0.0/0'],
      },
    ],
    [
      'urltest',
      'ut1',
      {
        section: 'sec',
        name: 'URLTest #1',
        check_interval: '3m',
        tolerance: '50',
        testing_url: 'https://www.gstatic.com/generate_204',
        expected_status: '*',
        idle_timeout: '30m',
        interrupt_exist_connections: '0',
        server_filter_mode: 'all',
      },
    ],
    [
      'fallback_group',
      'grp1',
      {
        section: 'sec',
        name: 'Fallback #1',
        health_check_url: 'https://www.gstatic.com/generate_204',
        health_check_interval: '5m',
        health_check_timeout: '5s',
        attempt_timeout: '5s',
        expected_status: '*',
        idle_timeout: '5m',
        interrupt_exist_connections: '0',
      },
    ],
    [
      'fallback_level',
      'lvl1',
      {
        group: 'grp1',
        name: 'Group #1',
        order: '0',
        server_filter_mode: 'direct',
      },
    ],
  ];
}

const CHILD_TYPES = [
  'connection_link',
  'subscription_url',
  'section_interface',
  'tunnel',
  'tunnel_peer',
  'urltest',
  'fallback_group',
  'fallback_level',
];
const EVERY_CHILD = [
  'grp1',
  'iface1',
  'link1',
  'lvl1',
  'peer1',
  'sub1',
  'tun1',
  'ut1',
];

function survivingChildren() {
  return CHILD_TYPES.flatMap((type) => itemsOfType(type)).sort();
}

const MIXED_SERVER_VALUES = {
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
};
const MIXED_SERVER = ['server', 'srv', MIXED_SERVER_VALUES];
const SERVER_ACCOUNT = [
  'server_client',
  'cl1',
  { server: 'srv', name: 'client-1', password: 'Ux-2LP-vrTXCc1wxJt5QUUvK' },
];

/* ----------------------------------------------- a list nobody could see */

describe('a list the dialog hides keeps its items', () => {
  // The dropdown holds the new action while the stored one is still the old:
  // the action option reads uci in cfgvalue(), so the widget is what decides.
  it.each(['bypass', 'block', 'dns', 'zapret'])(
    'changing a Connection section to %s keeps everything under it',
    async (action) => {
      addSections(connectionChildren());
      const grid = sectionGrid();
      grid.cfgsections = () => ['sec'];
      await grid.load();
      widgetAnswers(grid, { action });
      for (const option of grid.children) {
        await Promise.resolve()
          .then(() => option.parse('sec'))
          .catch(() => {});
      }

      expect(survivingChildren()).toEqual(EVERY_CHILD);
      // The one source a section holds itself, next to the five it holds as
      // child sections: hand-written outbound objects.
      expect(harness.uci.get('forkop', 'sec', 'outbound_jsons')).toBeTruthy();
    },
  );

  it.each([
    ['switching the protocol to tailscale', { protocol: 'tailscale' }],
    ['switching the protocol to json_inbound', { protocol: 'json_inbound' }],
    ['turning the authentication switch off', { mixed_auth_enabled: '0' }],
  ])('%s keeps the accounts of the server', async (_label, seed) => {
    addSections([MIXED_SERVER, SERVER_ACCOUNT]);
    const grid = serverGrid();
    grid.cfgsections = () => ['srv'];
    await grid.load();
    widgetAnswers(grid, seed);
    for (const option of grid.children) {
      await Promise.resolve()
        .then(() => option.parse('srv'))
        .catch(() => {});
    }

    expect(itemsOfType('server_client')).not.toEqual([]);
  });
});

/* ------------------------------------------- one text in two fields */

// A section's domains and addresses are one text. A routing section edits it in
// one field and a DNS section, which matches domains only, in another, so the
// field that is hidden has to leave the text to the one that is shown.
describe('the destinations of a section', () => {
  const FIELDS = [
    [
      'a Connection section',
      'connection',
      'destinations',
      'example.org\n192.0.2.0/24',
    ],
    ['a DNS section', 'dns', '_dns_destinations', 'example.org'],
  ];

  async function saveAs(action, destinations, answers = {}) {
    addSections([
      [
        'section',
        'sec',
        { action, enabled: '1', dns_server: ['tls://1.1.1.1'], destinations },
      ],
    ]);
    const grid = sectionGrid();
    grid.cfgsections = () => ['sec'];
    await grid.load();
    widgetAnswers(grid, answers);
    for (const option of grid.children) {
      await Promise.resolve()
        .then(() => option.parse('sec'))
        .catch(() => {});
    }
    return harness.uci.get('forkop', 'sec', 'destinations');
  }

  it.each(FIELDS)(
    'survive a save of %s',
    async (_label, action, _field, text) => {
      expect(await saveAs(action, text)).toBe(text);
    },
  );

  it.each(FIELDS)(
    'are what the field of %s says after an edit',
    async (_label, action, field) => {
      expect(
        await saveAs(action, 'old.example', { [field]: 'new.example' }),
      ).toBe('new.example');
    },
  );

  it.each(FIELDS)(
    'leave with the text the field of %s was emptied of',
    async (_label, action, field) => {
      expect(await saveAs(action, 'old.example', { [field]: '' })).toBeNull();
    },
  );

  it('survive a save of a section whose action shows neither field', async () => {
    expect(await saveAs('zapret', 'example.org')).toBe('example.org');
  });
});

/* ------------------------------ a subscription is named when it is added */

// A subscription becomes a provider named "<section>/<tag>" in the running
// configuration, so it needs a tag. Nobody has to type one: the list names an
// entry the moment its link is added, and the section's save writes that name out
// with the rest of the entry.
describe('a subscription is named when its link is added', () => {
  const LINKS = ['https://a.example/sub', 'https://b.example/sub'];

  async function saveSection(grid, values) {
    widgetAnswers(grid, { subscription_url: values });
    grid.children
      .find((option) => option.option === 'subscription_url')
      .onListChange('sec', values);
    for (const option of grid.children) {
      await Promise.resolve()
        .then(() => option.parse('sec'))
        .catch(() => {});
    }
  }

  function storedTags() {
    return harness.uci
      .sections('forkop', 'subscription_url')
      .map((item) => item.tag);
  }

  it('writes a tag for a link whose dialog was never opened', async () => {
    addSections([CONNECTION_SECTION]);
    const grid = sectionGrid();
    grid.cfgsections = () => ['sec'];
    await grid.load();

    await saveSection(grid, LINKS);

    expect(storedTags()).toEqual(['sub1', 'sub2']);
  });

  it('numbers a new link after the subscription the section has', async () => {
    addSections(connectionChildren());
    const grid = sectionGrid();
    grid.cfgsections = () => ['sec'];
    await grid.load();

    await saveSection(grid, ['sub1', LINKS[0]]);

    expect(storedTags().sort()).toEqual(['sub1', 'sub2']);
  });

  // sing-box refuses a configuration holding two providers under one name, so the
  // whole section fails to start. The dialog and the save have to hand out the
  // same names: whatever the dialog showed for one entry is what the save must
  // avoid for its siblings.
  it('does not name two subscriptions the same', async () => {
    addSections([CONNECTION_SECTION]);
    const grid = sectionGrid();
    grid.cfgsections = () => ['sec'];
    await grid.load();
    const list = grid.children.find(
      (option) => option.option === 'subscription_url',
    );
    widgetAnswers(grid, { subscription_url: LINKS });
    list.onListChange('sec', LINKS);

    const dialog = await harness.openDialog(list, 'sec', LINKS[1]);
    await dialog.save();
    for (const option of grid.children) {
      await Promise.resolve()
        .then(() => option.parse('sec'))
        .catch(() => {});
    }

    expect(storedTags().sort()).toEqual(['sub1', 'sub2']);
  });

  // The dialog has to agree with the save: it shows the name the entry is going
  // to be stored under, so pressing Save in it cannot rename the subscription.
  it('shows the same tag in the dialog of a link that has no section yet', async () => {
    addSections([CONNECTION_SECTION]);
    const grid = sectionGrid();
    grid.cfgsections = () => ['sec'];
    await grid.load();
    const list = grid.children.find(
      (option) => option.option === 'subscription_url',
    );
    widgetAnswers(grid, { subscription_url: LINKS });
    list.onListChange('sec', LINKS);

    const dialog = await harness.openDialog(list, 'sec', LINKS[1]);
    const tag = dialog.map.children[0].children.find(
      (option) => option.option === 'tag',
    );

    expect(tag.cfgvalue('settings')).toBe('sub2');
  });
});

/* --------------------------------- a list the user can see owns its items */

describe('a list the user can see owns its items', () => {
  it('clearing the tunnel list removes the tunnel and its peer, and nothing else', async () => {
    addSections(connectionChildren());
    const grid = sectionGrid();
    grid.cfgsections = () => ['sec'];
    await grid.load();
    widgetAnswers(grid, { tunnels: [] });
    for (const option of grid.children) {
      await Promise.resolve()
        .then(() => option.parse('sec'))
        .catch(() => {});
    }

    expect(itemsOfType('tunnel')).toEqual([]);
    expect(itemsOfType('tunnel_peer')).toEqual([]);
    expect(itemsOfType('subscription_url')).not.toEqual([]);
  });

  it('removing one tunnel from the list removes exactly that one', async () => {
    addSections(connectionChildren());
    harness.uci.add('forkop', 'tunnel', 'tun2');
    Object.assign(harness.store.get('tun2'), {
      section: 'sec',
      kind: 'wireguard',
      name: 'wg2',
      order: '1',
      private_key: WG_KEY,
      address: ['10.8.1.10/32'],
    });
    const grid = sectionGrid();
    grid.cfgsections = () => ['sec'];
    await grid.load();
    widgetAnswers(grid, { tunnels: ['tun1'] });
    for (const option of grid.children) {
      await Promise.resolve()
        .then(() => option.parse('sec'))
        .catch(() => {});
    }

    expect(itemsOfType('tunnel')).toEqual(['tun1']);
  });

  // A tunnel's dialog and a fallback group's write their item when they save, so
  // one added and taken out again leaves the list holding what it loaded, and
  // LuCI skips the write of a list that did not change.
  it('a tunnel or a fallback added and taken out again is gone after the save', async () => {
    addSections(connectionChildren());
    const grid = sectionGrid();
    grid.cfgsections = () => ['sec'];
    await grid.load();
    harness.uci.add('forkop', 'tunnel', 'tun2');
    Object.assign(harness.store.get('tun2'), {
      section: 'sec',
      kind: 'wireguard',
      name: 'wg2',
      private_key: WG_KEY,
      address: ['10.8.1.10/32'],
    });
    harness.uci.add('forkop', 'fallback_group', 'grp2');
    Object.assign(harness.store.get('grp2'), {
      section: 'sec',
      name: 'Fallback #2',
    });
    widgetAnswers(grid, { tunnels: ['tun1'], fallback_group: ['grp1'] });
    for (const option of grid.children) {
      await Promise.resolve()
        .then(() => option.parse('sec'))
        .catch(() => {});
    }

    expect(itemsOfType('tunnel')).toEqual(['tun1']);
    expect(itemsOfType('fallback_group')).toEqual(['grp1']);
  });

  // uci.js records every set of a stored section as a change, the value it
  // already holds included, and the page then reports changes nobody made. The
  // lists above are written on every save, so their write must leave alone an
  // item that already holds what it would set. LuCI's own flag on the section
  // itself writes on every save as well, and is no item.
  it('a save that changes nothing sets nothing on an item', async () => {
    addSections(connectionChildren());
    const grid = sectionGrid();
    grid.cfgsections = () => ['sec'];
    await grid.load();
    const sets = [];
    const set = harness.uci.set;
    harness.uci.set = (...args) => {
      if (args[1] !== 'sec') sets.push(args.slice(1).join(' '));
      return set.apply(harness.uci, args);
    };
    for (const option of grid.children) {
      await Promise.resolve()
        .then(() => option.parse('sec'))
        .catch(() => {});
    }
    harness.uci.set = set;

    expect(sets).toEqual([]);
  });
});

/* ------------------------------- removing an owner takes its children */

describe('removing an owner takes its children', () => {
  it('deleting a server takes its accounts', async () => {
    addSections([MIXED_SERVER, SERVER_ACCOUNT]);
    const grid = serverGrid();
    harness.bundle.configureServerSection(grid);
    grid.cfgsections = () => ['srv'];
    grid.map.data.remove = () => {};
    await grid.load();
    await Promise.resolve()
      .then(() => grid.handleRemove('srv'))
      .catch(() => {});

    expect(itemsOfType('server_client')).toEqual([]);
  });

  it('deleting a section takes everything under it', async () => {
    addSections(connectionChildren());
    const grid = sectionGrid();
    grid.handleRemove = () => Promise.resolve();
    harness.bundle.configureSectionSection(grid, {
      loadActionProvidersAvailability: () => Promise.resolve(ALL_PROVIDERS),
    });
    await grid.handleRemove('sec');

    expect(survivingChildren()).toEqual([]);
  });
});

/* -------------------------------------- a value the dropdown cannot show */

// A <select> hands back one of its own entries and nothing else, so a stored
// name the list has no entry for is replaced by whichever entry comes first.
// Every option below names another section, and every one of them can outlive
// its target: the target can be deleted, switched off, or belong to a DPI
// provider that is not installed.
const LIVE_SECTION = [
  'section',
  'live',
  {
    action: 'connection',
    enabled: '1',
    label: 'Live',
  },
];
const target = (enabled) => [
  'section',
  'target',
  {
    action: 'connection',
    enabled,
    label: 'Target',
  },
];

describe.each([
  ['its target was deleted', []],
  ['its target is switched off', [target('0')]],
])('a reference survives while %s', (_label, extra) => {
  it('on a DNS section', async () => {
    addSections([
      [
        'section',
        'sec',
        {
          action: 'dns',
          enabled: '1',
          label: 'DNS section',
          dns_server: ['tls://1.1.1.1'],
          destinations: 'example.com',
          dns_detour_enabled: '1',
          dns_detour_section: 'target',
        },
      ],
      LIVE_SECTION,
      ...extra,
    ]);
    await parseEveryOption(sectionGrid(), 'sec');

    expect(harness.uci.get('forkop', 'sec', 'dns_detour_section')).toBe(
      'target',
    );
  });

  it('on a server routing section', async () => {
    addSections([
      [
        'server',
        'srv',
        {
          ...MIXED_SERVER_VALUES,
          routing_mode: 'section',
          routing_section: 'target',
        },
      ],
      SERVER_ACCOUNT,
      LIVE_SECTION,
      ...extra,
    ]);
    await parseEveryOption(serverGrid(), 'srv');

    expect(harness.uci.get('forkop', 'srv', 'routing_section')).toBe('target');
  });

  it("on a server account's own routing section", async () => {
    addSections([
      MIXED_SERVER,
      [
        'server_client',
        'cl1',
        {
          ...SERVER_ACCOUNT[2],
          routing_override: '1',
          routing_mode: 'section',
          routing_section: 'target',
        },
      ],
      LIVE_SECTION,
      ...extra,
    ]);
    const grid = serverGrid();
    const list = grid.children.find((option) => option.option === 'clients');
    const dialog = await harness.openDialog(list, 'srv', 'cl1');
    const result = await dialog.save().catch(() => ({ saved: false }));

    expect(result.saved, 'the account dialog refused to save').toBe(true);
    expect(harness.uci.get('forkop', 'cl1', 'routing_section')).toBe('target');
  });

  it('on a server tailscale detour', async () => {
    addSections([
      [
        'server',
        'srv',
        {
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
        },
      ],
      LIVE_SECTION,
      ...extra,
    ]);
    await parseEveryOption(serverGrid(), 'srv');

    expect(harness.uci.get('forkop', 'srv', 'tailscale_detour_section')).toBe(
      'target',
    );
  });

  it('on every reference the Settings page holds', async () => {
    addSections([
      [
        'settings',
        'settings',
        {
          dns_server: ['tls://1.1.1.1'],
          bootstrap_dns_server: ['1.1.1.1'],
          dns_detour_enabled: '1',
          dns_detour_section: 'target',
          download_lists_via_proxy: '1',
          download_lists_via_proxy_section: 'target',
        },
      ],
      LIVE_SECTION,
      ...extra,
    ]);
    const map = new harness.form.Map('forkop');
    const settingsSection = map.section(harness.form.NamedSection, 'settings');
    harness.bundle.createSettingsContent(settingsSection, {
      loaded: true,
      ...ALL_PROVIDERS,
    });
    await parseEveryOption(settingsSection, 'settings');

    for (const name of [
      'dns_detour_section',
      'download_lists_via_proxy_section',
    ]) {
      expect(harness.uci.get('forkop', 'settings', name), name).toBe('target');
    }
  });

  it.each([
    [
      'subscription_url',
      'subscription_url',
      {
        url: 'https://example.com/sub',
        tag: 'sub1',
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
      'subscription_url',
      'subscription_url',
      {
        url: 'https://example.com/sub',
        tag: 'sub1',
        server_filter_mode: 'all',
        subscription_update_enabled: '1',
        subscription_update_interval: '1h',
        download_via_proxy_enabled: '0',
        show_dashboard_metadata: '1',
        detour_section: 'target',
      },
      'detour_section',
    ],
    [
      'connection_link',
      'connection_link',
      {
        uri: 'vless://o@example:1#n',
        name: 'n',
        order: '0',
        detour_section: 'target',
      },
      'detour_section',
    ],
    [
      'tunnel',
      'tunnels',
      {
        kind: 'warp',
        name: 'warp',
        order: '0',
        warp_profile_id: 'id',
        warp_profile_auth_token: 'token',
        warp_profile_private_key: WG_KEY,
        detour_section: 'target',
      },
      'detour_section',
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
  ])('in the %s dialog', async (type, listName, seed, key) => {
    addSections([
      [
        'section',
        'owner',
        {
          action: 'connection',
          enabled: '1',
          label: 'Owner',
        },
      ],
      [type, 'item', { section: 'owner', ...seed }],
      LIVE_SECTION,
      ...extra,
    ]);
    const grid = sectionGrid();
    const list = grid.children.find((option) => option.option === listName);
    const dialog = await harness.openDialog(list, 'owner', 'item');
    const result = await dialog.save().catch(() => ({ saved: false }));

    expect(result.saved, `the ${type} dialog refused to save`).toBe(true);
    expect(harness.uci.get('forkop', 'item', key)).toBe('target');
  });
});

// A DNS detour may point at a DPI section, and the list of DPI sections shrinks
// when the provider is gone.
it('a DNS detour survives a target whose provider is not installed', async () => {
  addSections([
    [
      'section',
      'sec',
      {
        action: 'dns',
        enabled: '1',
        label: 'DNS section',
        dns_server: ['tls://1.1.1.1'],
        destinations: 'example.com',
        dns_detour_enabled: '1',
        dns_detour_section: 'target',
      },
    ],
    LIVE_SECTION,
    [
      'section',
      'target',
      {
        action: 'zapret',
        enabled: '1',
        label: 'Target',
        nfqws_opt: '--dpi-desync=fake',
        destinations: 'example.com',
      },
    ],
  ]);
  await parseEveryOption(sectionGrid(NO_PROVIDERS), 'sec');

  expect(harness.uci.get('forkop', 'sec', 'dns_detour_section')).toBe('target');
});

// The provider a DPI section needs can be missing - uninstalled, or an answer
// that did not arrive - and the action list is built from what is installed. The
// section still works: the configuration check leaves a rule whose provider is
// absent alone. Its action must survive a save that never showed the choice.
describe.each([
  ['zapret', 'nfqws_opt', '--dpi-desync=fake'],
  ['zapret2', 'nfqws2_opt', '--dpi-desync=fake'],
  ['byedpi', 'byedpi_cmd_opts', '-Kt,h'],
])(
  'a %s section whose provider is not installed',
  (action, field, strategy) => {
    beforeEach(async () => {
      addSections([
        [
          'section',
          'sec',
          {
            action,
            enabled: '1',
            label: 'DPI section',
            destinations: 'example.com',
            [field]: strategy,
          },
        ],
      ]);
      await parseEveryOption(sectionGrid(NO_PROVIDERS), 'sec');
    });

    it('keeps its action', () => {
      expect(harness.uci.get('forkop', 'sec', 'action')).toBe(action);
    });

    it('keeps its strategy', () => {
      expect(harness.uci.get('forkop', 'sec', field)).toBeTruthy();
    });
  },
);

/* ---------------------------------------- what a creation default writes */

// A default written when an item is added has to be an option something reads.
// user_agent was moved into the ordinary headers and a migration deletes it, and
// show_subscription_name went when the tag started being shown always, so writing
// either again gives every new subscription a dead option that nothing will ever
// clear.
it('adding a subscription writes no option nothing reads', async () => {
  addSections([CONNECTION_SECTION]);
  const grid = sectionGrid();
  grid.cfgsections = () => ['sec'];
  await grid.load();
  const list = grid.children.find(
    (option) => option.option === 'subscription_url',
  );
  list.formvalue = () => ['https://example.com/new'];
  await Promise.resolve()
    .then(() => list.parse('sec'))
    .catch(() => {});

  const added = harness.uci
    .sections('forkop', 'subscription_url')
    .find((item) => item.url === 'https://example.com/new');
  expect(added, 'no subscription section was created').toBeTruthy();
  expect(added.user_agent).toBeUndefined();
  expect(added.show_subscription_name).toBeUndefined();
});

/* ------------------------------------------------------ a refused save says why */

// LuCI keeps a dialog open when its save is refused and says nothing, so the
// reason has to reach the user some other way.
describe('a nested dialog that refuses to save', () => {
  it('says why', async () => {
    addSections([
      [
        'section',
        'sec',
        { action: 'connection', enabled: '1', label: 'proxy' },
      ],
      [
        'tunnel',
        'tun1',
        {
          section: 'sec',
          kind: 'wireguard',
          name: 'wg',
          order: '0',
          private_key: WG_KEY,
          address: ['10.8.1.9/32'],
        },
      ],
    ]);
    const grid = sectionGrid();
    const list = grid.children.find((option) => option.option === 'tunnels');
    const dialog = await harness.openDialog(list, 'sec', 'tun1');
    const result = await dialog.save();

    expect(result.saved).toBe(false);
    expect(harness.toasts()).toEqual([
      'Option "Peers" contains an invalid input value. Add at least one WireGuard peer',
    ]);
  });
});

/* ------------------------------------------- a check reads the dialog it is in */

// A check that depends on a switch has to see the switch as the dialog shows it:
// the one turned on a moment ago, not the one stored when the dialog opened.
describe('a check behind a switch turned on in the same dialog', () => {
  function dialogOption(dialog, name) {
    return dialog.map.children[0].children.find(
      (option) => option.option === name,
    );
  }

  function turnOn(dialog, name) {
    dialogOption(dialog, name).formvalue = () => '1';
  }

  it('refuses a subscription requested through no section', async () => {
    const links = ['https://a.example/sub'];
    addSections([CONNECTION_SECTION]);
    const grid = sectionGrid();
    grid.cfgsections = () => ['sec'];
    await grid.load();
    const list = grid.children.find(
      (option) => option.option === 'subscription_url',
    );
    widgetAnswers(grid, { subscription_url: links });
    list.onListChange('sec', links);
    const dialog = await harness.openDialog(list, 'sec', links[0]);
    turnOn(dialog, 'download_via_proxy_enabled');

    expect(
      dialogOption(dialog, 'download_via_proxy_section').validate(
        'settings',
        '',
      ),
    ).toBe('Select a section for downloading this subscription');
  });

  it('checks the DNS servers of an interface resolver', async () => {
    addSections([
      [
        'section',
        'sec',
        { action: 'connection', enabled: '1', label: 'proxy' },
      ],
      [
        'section_interface',
        'iface1',
        {
          section: 'sec',
          name: 'wan',
          display_name: 'WAN',
          domain_resolver_enabled: '0',
        },
      ],
    ]);
    const grid = sectionGrid();
    const list = grid.children.find((option) => option.option === 'interfaces');
    const dialog = await harness.openDialog(list, 'sec', 'iface1');
    turnOn(dialog, 'domain_resolver_enabled');

    expect(
      dialogOption(dialog, 'domain_resolver_dns_server').validate(
        'settings',
        'not a server',
      ),
    ).not.toBe(true);
  });

  it('refuses an interface resolver sent through no section', async () => {
    addSections([
      [
        'section',
        'sec',
        { action: 'connection', enabled: '1', label: 'proxy' },
      ],
      [
        'section_interface',
        'iface1',
        {
          section: 'sec',
          name: 'wan',
          display_name: 'WAN',
          domain_resolver_enabled: '1',
          domain_resolver_dns_server: ['1.1.1.1'],
          domain_resolver_dns_detour_enabled: '0',
        },
      ],
    ]);
    const grid = sectionGrid();
    const list = grid.children.find((option) => option.option === 'interfaces');
    const dialog = await harness.openDialog(list, 'sec', 'iface1');
    turnOn(dialog, 'domain_resolver_dns_detour_enabled');

    expect(
      dialogOption(dialog, 'domain_resolver_dns_detour_section').validate(
        'settings',
        '',
      ),
    ).toBe('Select a section');
  });
});
