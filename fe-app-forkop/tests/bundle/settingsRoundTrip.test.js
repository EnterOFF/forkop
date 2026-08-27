// Opening a dialog and pressing Save without touching anything must leave the
// configuration exactly as it was.
//
// LuCI drops a hidden option when a form is saved, and it keeps whatever load()
// returned as an option's stored value. Between those two rules a dialog can
// quietly rewrite what it was showing: a default written when an item was created
// for a field the dialog then hides is deleted on the first save, and a value the
// dialog invents while rendering is written on a save the user did not ask for.
// Either way the page reports a change nobody made, and Save & Apply restarts the
// service for it.
//
// So every form is driven twice here: fill it in, save, then open and save again
// and expect nothing at all.
import fs from 'fs';

import { beforeEach, describe, expect, it } from 'vitest';

import { ROOT } from '../lib/paths.js';
import { createHarness } from '../lib/luciForm.js';

let harness;

beforeEach(() => {
  harness = createHarness();
});

// A value a child item's list accepts, so the probe item looks like one the user
// added rather than an empty section.
const SAMPLE_VALUE = {
  subscription_url: 'https://example.com/sub',
  section_interface: 'lan1',
  urltest: 'group1',
  fallback_group: 'fallback1',
  fallback_level: 'level1',
  tunnel: 'tunnel1',
  tunnel_peer: 'peer1',
  server_client: 'client1',
};
// The peer list names its child type through materializeTunnelPeers instead of
// carrying it on the option.
const TYPE_BY_OPTION = { peer_ids: 'tunnel_peer' };

async function parseEveryOption(section, sid) {
  for (const option of section.children) {
    await Promise.resolve()
      .then(() => option.parse(sid))
      .catch(() => {});
  }
}

/* ------------------------------------------------- every child item dialog */

let probeCounter = 0;

// What createChildItem() stores for a freshly added item, by the same rules.
function createItem(ownerId, option, typeName) {
  probeCounter += 1;
  const itemId = `${typeName}_probe_${probeCounter}`;
  const value = SAMPLE_VALUE[typeName] || 'probe';
  harness.uci.add('forkop', typeName, itemId);
  harness.uci.set('forkop', itemId, option.ownerOption || 'section', ownerId);
  if (option.childValueOption) {
    harness.uci.set('forkop', itemId, option.childValueOption, value);
  }
  Object.entries(option.childDefaults || {}).forEach(([key, raw]) => {
    const resolved =
      typeof raw === 'function' ? raw(value, ownerId, itemId) : raw;
    if (resolved === undefined || resolved === null || resolved === '') return;
    harness.uci.set(
      'forkop',
      itemId,
      key,
      Array.isArray(resolved)
        ? resolved.map((item) => `${item || ''}`).filter(Boolean)
        : `${resolved}`,
    );
  });
  return itemId;
}

async function checkDialog(problems, ownerId, option) {
  const typeName = option.childType || TYPE_BY_OPTION[option.option];
  if (!typeName || typeof option.renderItemSettingsModal !== 'function') return;

  const itemId = createItem(ownerId, option, typeName);
  const stored = JSON.stringify(harness.uci.get('forkop', itemId));
  harness.operations.length = 0;

  let dialog;
  try {
    dialog = await harness.openDialog(option, ownerId, itemId);
  } catch (error) {
    problems.push(`${option.option}: ${error.message}`);
    return;
  }
  try {
    await dialog.save();
  } catch (error) {
    problems.push(
      `${option.option}: saving the dialog threw: ${error && error.message}`,
    );
    return;
  }

  if (harness.operations.length) {
    problems.push(
      `saving the ${typeName} dialog without a change rewrote the section: ` +
        `${harness.operations.join(', ')} (stored ${stored})`,
    );
  }
  harness.operations.length = 0;

  // Lists nested in the dialog - fallback levels, WireGuard peers - are the same
  // kind of item and get the same question.
  for (const child of dialog.map.children.flatMap(
    (section) => section.children,
  )) {
    if (
      typeof child.renderItemSettingsModal === 'function' &&
      (child.childType || TYPE_BY_OPTION[child.option])
    ) {
      await checkDialog(problems, itemId, child);
    }
  }
}

describe('a child item dialog', () => {
  it('writes nothing when it is saved unchanged', async () => {
    const view = harness.bundle;

    harness.uci.add('forkop', 'section', 'section_probe');
    harness.uci.set('forkop', 'section_probe', 'action', 'connection');
    harness.uci.set('forkop', 'section_probe', 'enabled', '1');
    harness.uci.set('forkop', 'section_probe', 'label', 'Section #1');
    harness.uci.add('forkop', 'server', 'server_probe');
    harness.uci.set('forkop', 'server_probe', 'protocol', 'vless');
    harness.uci.set('forkop', 'server_probe', 'name', 'srv1');

    const map = new harness.form.Map('forkop');
    const connection = map.section(harness.form.GridSection, 'section');
    view.createSectionContent(connection);

    const serverMap = new harness.form.Map('forkop');
    const server = serverMap.section(harness.form.GridSection, 'server');
    view.createServerContent(server);

    // A silent scrape is not a passing test.
    const found = [...connection.children, ...server.children]
      .filter(
        (option) =>
          typeof option.renderItemSettingsModal === 'function' &&
          (option.childType || TYPE_BY_OPTION[option.option]),
      )
      .map((option) => option.option);
    for (const expected of [
      'subscription_url',
      'interfaces',
      'urltest',
      'clients',
    ]) {
      expect(found, `the ${expected} dialog was not found`).toContain(expected);
    }

    const problems = [];
    for (const option of connection.children) {
      await checkDialog(problems, 'section_probe', option);
    }
    for (const option of server.children) {
      await checkDialog(problems, 'server_probe', option);
    }

    expect(problems.join('\n')).toBe('');
  });
});

/* ------------------------------------------------ every field a form shows */

// The values come from the form itself: fill every field, save, then open and
// save again and expect nothing. Only the field that picks the state - the action
// of a section, the protocol of a server - is held back, so each state is reached
// once. Everything else is filled and LuCI decides which of them are shown; a
// field it hides writes nothing in either pass, so the two passes see the same
// form.
function probeFormValue(option) {
  const cls = option.__name__ || '';
  const choices = (option.keylist || []).filter((key) => `${key ?? ''}` !== '');
  const other = choices.filter((key) => `${key}` !== `${option.default}`);
  const pick = other.length
    ? `${other[0]}`
    : choices.length
      ? `${choices[0]}`
      : '';
  if (cls === 'CBI.FlagValue') return `${option.default}` === '1' ? '0' : '1';
  if (cls === 'CBI.DynamicList' || cls === 'CBI.MultiValue') {
    return [pick || 'probe-value'];
  }
  if (pick) return pick;
  if (/port/.test(`${option.datatype ?? ''}`) || /_port$/.test(option.option)) {
    return '18080';
  }
  if (/range|uinteger/.test(`${option.datatype ?? ''}`)) return '1280';
  return 'probe-value';
}

function buildSection(action) {
  const view = harness.bundle;
  harness.uci.add('forkop', 'section', 'probe');
  Object.assign(harness.store.get('probe'), {
    action,
    enabled: '1',
    label: 'Probe',
  });
  const map = new harness.form.Map('forkop');
  const grid = map.section(harness.form.GridSection, 'section');
  view.configureSectionSection(grid);
  // The table's load() skips the modal-only options; the dialog loads them all.
  delete grid.load;
  view.createSectionContent(grid);
  return { section: grid, sid: 'probe' };
}

function buildServer(protocol) {
  const view = harness.bundle;
  harness.uci.add('forkop', 'server', 'probe');
  Object.assign(harness.store.get('probe'), {
    protocol,
    enabled: '1',
    label: 'Probe',
  });
  harness.uci.add('forkop', 'server_client', 'client_probe');
  Object.assign(harness.store.get('client_probe'), {
    server: 'probe',
    name: 'client-1',
    password: 'secret',
    uuid: '3d0f9c1a-9c1a-4d0f-8c1a-9c1a3d0f9c1a',
    secret: 'ee00112233445566778899aabbccddeeff6578616d706c652e636f6d',
  });
  const map = new harness.form.Map('forkop');
  const grid = map.section(harness.form.GridSection, 'server');
  view.createServerContent(grid);
  return { section: grid, sid: 'probe' };
}

function buildSettings() {
  const view = harness.bundle;
  harness.uci.add('forkop', 'settings', 'settings');
  harness.uci.add('forkop', 'section', 'live');
  Object.assign(harness.store.get('live'), {
    action: 'connection',
    enabled: '1',
    label: 'Live',
    selector_proxy_links: ['vless://a@example:1#n'],
  });
  const map = new harness.form.Map('forkop');
  const settings = map.section(harness.form.NamedSection, 'settings');
  view.createSettingsContent(settings);
  return { section: settings, sid: 'settings' };
}

async function roundTrip(build, state, selector) {
  const { section, sid } = build(state);
  section.cfgsections = () => [sid];
  await section.load();

  // Fill in every field, the way a user filling the whole dialog would.
  const filled = [];
  for (const option of section.children) {
    if (option.option === selector || option.option === 'enabled') continue;
    if (['CBI.DummyValue', 'CBI.ButtonValue'].includes(option.__name__)) {
      continue;
    }
    const value = probeFormValue(option);
    option.formvalue = () => value;
    filled.push(option.option);
  }
  await parseEveryOption(section, sid);
  section.children.forEach((option) => delete option.formvalue);

  // Now the configuration is one this form produced. Opening it and saving it
  // again must write nothing at all.
  await section.load();
  harness.operations.length = 0;
  await parseEveryOption(section, sid);
  return { filled, operations: harness.operations.slice() };
}

// Every action and every protocol the dropdowns offer, discovered from the form
// so a new one is asked the question too.
const choicesOf = async (build, seed, name) => {
  const scratch = createHarness();
  const previous = harness;
  harness = scratch;
  try {
    const { section, sid } = build(seed);
    section.cfgsections = () => [sid];
    await section.load();
    return (
      section.children.find((option) => option.option === name)?.keylist || []
    ).slice();
  } finally {
    harness = previous;
  }
};

const ACTIONS = await choicesOf(buildSection, 'connection', 'action');
const PROTOCOLS = await choicesOf(buildServer, 'mixed', 'protocol');

it('the action and protocol dropdowns offer what they used to', () => {
  expect(ACTIONS.length).toBeGreaterThanOrEqual(4);
  expect(PROTOCOLS.length).toBeGreaterThanOrEqual(10);
});

describe.each([
  ['a section', ACTIONS, 'action'],
  ['a server', PROTOCOLS, 'protocol'],
  ['the Settings page', [''], null],
])('%s', (label, states, selector) => {
  const build =
    label === 'a section'
      ? buildSection
      : label === 'a server'
        ? buildServer
        : buildSettings;

  it.each(states)(
    'writes nothing when a form it filled in itself is saved again (%s)',
    async (state) => {
      const { filled, operations } = await roundTrip(build, state, selector);

      expect(
        filled.length,
        'too few fields were filled for this to check anything',
      ).toBeGreaterThanOrEqual(3);
      expect(operations.join(', ')).toBe('');
    },
  );
});

/* ------------------------------------------------------- the shipped config */

// The shipped configuration is written by the package, not by the form, so it is
// the other place a stored value can name an option the page hides.
it('the Settings page writes nothing when the shipped config is saved', async () => {
  let current = null;
  const source = fs.readFileSync(
    `${ROOT}/forkop/files/etc/config/forkop`,
    'utf8',
  );
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    let matched = /^config\s+(\S+)(?:\s+'([^']*)')?/.exec(line);
    if (matched) {
      current = harness.uci.add('forkop', matched[1], matched[2] || undefined);
      continue;
    }
    matched = /^option\s+(\S+)\s+'([^']*)'/.exec(line);
    if (matched && current) {
      harness.store.get(current)[matched[1]] = matched[2];
      continue;
    }
    matched = /^list\s+(\S+)\s+'([^']*)'/.exec(line);
    if (matched && current) {
      const section = harness.store.get(current);
      section[matched[1]] = (section[matched[1]] || []).concat(matched[2]);
    }
  }
  expect(
    harness.uci.get('forkop', 'settings'),
    'the shipped config has no settings section',
  ).toBeTruthy();

  const map = new harness.form.Map('forkop');
  const section = map.section(harness.form.NamedSection, 'settings');
  harness.bundle.createSettingsContent(section);
  await section.load();
  harness.operations.length = 0;
  await section.parse();

  expect(harness.operations.join(', ')).toBe('');
});

/* --------------------------------------------------------- the hidden values */

// The tag names the subscription's provider whether or not it is added to the
// node names, so unlike the resolver options it is in effect while its field is
// hidden and has to survive a save that does not show it.
describe('a subscription tag', () => {
  let list;
  const findOption = (dialog, name) =>
    dialog.map.children[0].children.find((option) => option.option === name);

  beforeEach(() => {
    harness.uci.add('forkop', 'section', 'section_probe');
    harness.uci.set('forkop', 'section_probe', 'action', 'connection');

    const map = new harness.form.Map('forkop');
    const connection = map.section(harness.form.GridSection, 'section');
    harness.bundle.createSectionContent(connection);
    list = connection.children.find(
      (option) => option.option === 'subscription_url',
    );

    ['sub_first', 'sub_second'].forEach((itemId, index) => {
      harness.uci.add('forkop', 'subscription_url', itemId);
      harness.uci.set('forkop', itemId, 'section', 'section_probe');
      harness.uci.set('forkop', itemId, 'url', `https://example.com/${index}`);
      harness.uci.set(
        'forkop',
        itemId,
        'show_subscription_name',
        index === 0 ? '1' : '0',
      );
      harness.uci.set('forkop', itemId, 'tag', `sub${index + 1}`);
    });
    // The dialog is only reachable from the rendered list, and the tag rules read
    // that list rather than the config: an entry the user has taken out is still
    // stored until the section is saved.
    list.cfgvalue('section_probe', ['sub_first', 'sub_second']);
  });

  it('survives a save that does not show it', async () => {
    const dialog = await harness.openDialog(
      list,
      'section_probe',
      'sub_second',
    );
    const tag = findOption(dialog, 'tag');

    expect(
      tag,
      'the subscription dialog no longer has a tag field',
    ).toBeTruthy();
    expect(
      tag.isActive('settings'),
      'the tag field is shown for a subscription that does not add its tag',
    ).toBe(false);
    expect(
      tag.retain,
      'the tag field does not retain the name the provider is generated with',
    ).toBe(true);

    await dialog.save();

    expect(harness.uci.get('forkop', 'sub_second', 'tag')).toBe('sub2');
  });

  it('survives being switched off', async () => {
    const dialog = await harness.openDialog(list, 'section_probe', 'sub_first');
    findOption(dialog, 'show_subscription_name').cfgvalue('settings', '0');

    await dialog.save();

    expect(harness.uci.get('forkop', 'sub_first', 'tag')).toBe('sub1');
  });

  // The way validate_subscription_tags() refuses it in the backend.
  it('is refused when another subscription already uses it', async () => {
    const dialog = await harness.openDialog(
      list,
      'section_probe',
      'sub_second',
    );

    expect(findOption(dialog, 'tag').validate('settings', 'sub1')).not.toBe(
      true,
    );
  });
});

// Two fields present the same rule set list, one for DNS rules and one for
// everything else, so the hidden one must not clear what the shown one holds.
describe.each(['connection', 'proxy', 'bypass', 'block', 'dns'])(
  'saving a %s section',
  (action) => {
    beforeEach(async () => {
      harness.uci.add('forkop', 'section', 'section_probe');
      Object.assign(harness.store.get('section_probe'), {
        action,
        enabled: '1',
        label: 'Probe',
        rule_set: ['https://example.com/list.srs'],
        rule_set_with_subnets: ['https://example.com/list.srs'],
        community_lists: ['youtube'],
      });

      const map = new harness.form.Map('forkop');
      const grid = map.section(harness.form.GridSection, 'section');
      harness.bundle.createSectionContent(grid);
      grid.cfgsections = () => ['section_probe'];
      await grid.load();
      await parseEveryOption(grid, 'section_probe');
    });

    it('keeps its rule sets', () => {
      expect(`${harness.uci.get('forkop', 'section_probe', 'rule_set')}`).toBe(
        'https://example.com/list.srs',
      );
    });

    it('keeps the subnets flag of its rule set', () => {
      expect(
        `${harness.uci.get('forkop', 'section_probe', 'rule_set_with_subnets')}`,
      ).toBe('https://example.com/list.srs');
    });

    it('keeps its built-in lists', () => {
      expect(
        `${harness.uci.get('forkop', 'section_probe', 'community_lists')}`,
      ).toBe('youtube');
    });
  },
);

// The tunnel dialog owns every field of its item and clears the ones the kind no
// longer has, which must not turn a save that changed nothing into a rewrite of
// the whole tunnel.
describe('a tunnel dialog', () => {
  it('writes nothing when it is saved unchanged', async () => {
    harness.uci.add('forkop', 'section', 'section_probe');
    Object.assign(harness.store.get('section_probe'), {
      action: 'connection',
      enabled: '1',
      label: 'Probe',
    });
    harness.uci.add('forkop', 'tunnel', 'tunnel_probe');
    Object.assign(harness.store.get('tunnel_probe'), {
      section: 'section_probe',
      order: '0',
      kind: 'wireguard',
      name: 'wg tunnel',
      address: ['10.8.1.9/32'],
      private_key: 'zz5/p+jwYqPFlg9mWcOP5ad8xXa4XfOOlrzouVD6E1w=',
      mtu: '1280',
    });
    harness.uci.add('forkop', 'tunnel_peer', 'peer_probe');
    Object.assign(harness.store.get('peer_probe'), {
      tunnel: 'tunnel_probe',
      order: '0',
      address: 'peer.example',
      port: '47132',
      public_key: 'AKR8dq2b9o7/cO8d5mAzxvuxRhhw4DXi1pfUC3IPGWo=',
      allowed_ips: ['0.0.0.0/0'],
    });

    const map = new harness.form.Map('forkop');
    const grid = map.section(harness.form.GridSection, 'section');
    harness.bundle.createSectionContent(grid);
    const tunnels = grid.children.find((option) => option.option === 'tunnels');
    harness.operations.length = 0;
    const dialog = await harness.openDialog(
      tunnels,
      'section_probe',
      'tunnel_probe',
    );
    await dialog.save();

    expect(harness.operations.join(', ')).toBe('');
    expect(harness.uci.get('forkop', 'tunnel_probe', 'name')).toBe('wg tunnel');
  });
});

// The backend keeps every server's security saying which mode the protocol runs
// with, including for protocols whose dialog has no field for it. The dialog must
// not undo that: it would be deleted on every save and written back on every
// apply, reporting a change nobody made.
describe('the security of a Mixed server', () => {
  it('survives a save that does not show it', async () => {
    harness.uci.add('forkop', 'server', 'server_probe');
    Object.assign(harness.store.get('server_probe'), {
      protocol: 'mixed',
      label: 'Probe',
      name: 'srv',
      listen_port: '1080',
      security: 'none',
    });
    harness.uci.add('forkop', 'server_client', 'client_probe');
    Object.assign(harness.store.get('client_probe'), {
      server: 'server_probe',
      name: 'client-1',
      password: 'secret',
    });
    harness.uci.set('forkop', 'server_probe', 'clients', ['client_probe']);

    const map = new harness.form.Map('forkop');
    const section = map.section(harness.form.GridSection, 'server');
    harness.bundle.createServerContent(section);
    section.cfgsections = () => ['server_probe'];
    await section.load();

    const security = section.children.find(
      (option) => option.option === 'security',
    );
    expect(
      security,
      'the server dialog no longer has a security field',
    ).toBeTruthy();
    expect(
      security.isActive('server_probe'),
      'a mixed server now shows a security field, so this checks nothing',
    ).toBe(false);

    await parseEveryOption(section, 'server_probe');

    expect(harness.uci.get('forkop', 'server_probe', 'security')).toBe('none');
  });
});
