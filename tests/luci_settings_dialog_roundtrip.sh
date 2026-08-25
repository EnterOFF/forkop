#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ROOT_DIR="$ROOT_DIR" node - <<'NODE'
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = process.env.ROOT_DIR;
const { createHarness } = require(path.join(root, 'tests/helpers/luci_form.js'));

const problems = [];
function fail(message) {
  problems.push(message);
}

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

// What createChildItem() stores for a freshly added item, by the same rules.
function createItem(harness, ownerId, option, typeName) {
  const itemId = `${typeName}_probe_${(createItem.counter = (createItem.counter || 0) + 1)}`;
  const value = SAMPLE_VALUE[typeName] || 'probe';
  harness.uci.add('forkop', typeName, itemId);
  harness.uci.set('forkop', itemId, option.ownerOption || 'section', ownerId);
  if (option.childValueOption) {
    harness.uci.set('forkop', itemId, option.childValueOption, value);
  }
  Object.entries(option.childDefaults || {}).forEach(([key, raw]) => {
    const resolved = typeof raw === 'function' ? raw(value, ownerId, itemId) : raw;
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

// Opening a settings dialog and pressing Save without touching anything must
// leave the configuration alone. It does not when the item was created with a
// default for an option the dialog hides: LuCI drops a hidden option on save, so
// the value the add wrote is deleted again and the page reports a change the
// user never made.
async function checkDialog(harness, ownerId, option, depth) {
  const typeName = option.childType || TYPE_BY_OPTION[option.option];
  if (!typeName || typeof option.renderItemSettingsModal !== 'function') return;

  const itemId = createItem(harness, ownerId, option, typeName);
  const stored = JSON.stringify(harness.uci.get('forkop', itemId));
  harness.operations.length = 0;

  let dialog;
  try {
    dialog = await harness.openDialog(option, ownerId, itemId);
  } catch (error) {
    fail(`${option.option}: ${error.message}`);
    return;
  }
  try {
    await dialog.save();
  } catch (error) {
    fail(`${option.option}: saving the dialog threw: ${error && error.message}`);
    return;
  }

  if (harness.operations.length) {
    fail(
      `saving the ${typeName} dialog without a change rewrote the section: ` +
        `${harness.operations.join(', ')} (stored ${stored})`,
    );
  }
  harness.operations.length = 0;

  // Lists nested in the dialog - fallback levels, WireGuard peers - are the same
  // kind of item and get the same question.
  for (const child of dialog.map.children.flatMap((section) => section.children)) {
    if (
      typeof child.renderItemSettingsModal === 'function' &&
      (child.childType || TYPE_BY_OPTION[child.option])
    ) {
      await checkDialog(harness, itemId, child, depth + 1);
    }
  }
}

async function checkChildDialogs() {
  const harness = createHarness(root);
  const view = harness.load('section');
  const serverView = harness.load('server');

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
  serverView.createServerContent(server);

  const dialogs = [...connection.children, ...server.children].filter(
    (option) =>
      typeof option.renderItemSettingsModal === 'function' &&
      (option.childType || TYPE_BY_OPTION[option.option]),
  );
  // A silent scrape is not a passing test.
  for (const expected of ['subscription_url', 'interfaces', 'urltest', 'clients']) {
    if (!dialogs.some((option) => option.option === expected)) {
      fail(`the ${expected} settings dialog was not found, so it is not checked`);
    }
  }

  for (const option of connection.children) {
    await checkDialog(harness, 'section_probe', option, 0);
  }
  for (const option of server.children) {
    await checkDialog(harness, 'server_probe', option, 0);
  }
}

// The shipped configuration is written by the package, not by the form, so it is
// the other place a stored value can name an option the page hides.
async function checkShippedSettings() {
  const harness = createHarness(root);
  let current = null;
  const source = fs.readFileSync(
    path.join(root, 'forkop/files/etc/config/forkop'),
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
  assert(harness.uci.get('forkop', 'settings'), 'the shipped config has no settings section');

  const settings = harness.load('settings');
  const map = new harness.form.Map('forkop');
  const section = map.section(harness.form.NamedSection, 'settings');
  settings.createSettingsContent(section);
  await section.load();
  harness.operations.length = 0;
  await section.parse();
  if (harness.operations.length) {
    fail(
      'saving the Settings page without a change rewrote the shipped config: ' +
        harness.operations.join(', '),
    );
  }
}

// The tag names the subscription's provider whether or not it is added to the
// node names, so unlike the resolver options it is in effect while its field is
// hidden and has to survive a save that does not show it.
async function checkSubscriptionTag() {
  const harness = createHarness(root);
  const view = harness.load('section');
  harness.uci.add('forkop', 'section', 'section_probe');
  harness.uci.set('forkop', 'section_probe', 'action', 'connection');

  const map = new harness.form.Map('forkop');
  const connection = map.section(harness.form.GridSection, 'section');
  view.createSectionContent(connection);
  const list = connection.children.find((option) => option.option === 'subscription_url');

  ['sub_first', 'sub_second'].forEach((itemId, index) => {
    harness.uci.add('forkop', 'subscription_url', itemId);
    harness.uci.set('forkop', itemId, 'section', 'section_probe');
    harness.uci.set('forkop', itemId, 'url', `https://example.com/${index}`);
    harness.uci.set('forkop', itemId, 'show_subscription_name', index === 0 ? '1' : '0');
    harness.uci.set('forkop', itemId, 'tag', `sub${index + 1}`);
  });

  const findOption = (dialog, name) =>
    dialog.map.children[0].children.find((option) => option.option === name);

  // The second one keeps its tag hidden, and saving must not take it away.
  const hidden = await harness.openDialog(list, 'section_probe', 'sub_second');
  const tag = findOption(hidden, 'tag');
  if (!tag) {
    fail('the subscription dialog no longer has a tag field');
    return;
  }
  if (tag.isActive('settings')) {
    fail('the tag field is shown for a subscription that does not add its tag');
  }
  if (!tag.retain) {
    fail('the tag field does not retain the name the provider is generated with');
  }
  await hidden.save();
  if (harness.uci.get('forkop', 'sub_second', 'tag') !== 'sub2') {
    fail('saving a subscription that hides its tag dropped the tag');
  }

  // Turning the tag off on the first one must keep it for the same reason.
  const shown = await harness.openDialog(list, 'section_probe', 'sub_first');
  findOption(shown, 'show_subscription_name').cfgvalue('settings', '0');
  await shown.save();
  if (harness.uci.get('forkop', 'sub_first', 'tag') !== 'sub1') {
    fail('hiding the tag dropped the name the provider is generated with');
  }

  // A tag another subscription already uses is refused, the way
  // validate_subscription_tags() refuses it.
  const dialog = await harness.openDialog(list, 'section_probe', 'sub_second');
  if (findOption(dialog, 'tag').validate('settings', 'sub1') === true) {
    fail('the dialog accepts a tag another subscription already uses');
  }
}

// Two fields present the same rule set list, one for DNS rules and one for
// everything else, so the hidden one must not clear what the shown one holds.
async function checkRuleSetsSurviveEveryAction() {
  for (const action of ['connection', 'proxy', 'bypass', 'block', 'dns']) {
    const harness = createHarness(root);
    const view = harness.load('section');
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
    view.createSectionContent(grid);
    grid.cfgsections = () => ['section_probe'];
    await grid.load();
    await Promise.all(
      grid.children.map((option) =>
        Promise.resolve()
          .then(() => option.parse('section_probe'))
          .catch(() => {}),
      ),
    );

    const after = harness.uci.get('forkop', 'section_probe');
    if (`${after.rule_set}` !== 'https://example.com/list.srs') {
      fail(`saving a ${action} section dropped its rule sets: ${JSON.stringify(after.rule_set)}`);
    }
    if (`${after.rule_set_with_subnets}` !== 'https://example.com/list.srs') {
      fail(`saving a ${action} section dropped the subnets flag of its rule set`);
    }
    if (`${after.community_lists}` !== 'youtube') {
      fail(`saving a ${action} section dropped its built-in lists`);
    }
  }
}

// The tunnel dialog owns every field of its item and clears the ones the kind no
// longer has, which must not turn a save that changed nothing into a rewrite of
// the whole tunnel.
async function checkTunnelRoundTrip() {
  const harness = createHarness(root);
  const view = harness.load('section');
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
  view.createSectionContent(grid);
  const tunnels = grid.children.find((option) => option.option === 'tunnels');
  harness.operations.length = 0;
  const dialog = await harness.openDialog(tunnels, 'section_probe', 'tunnel_probe');
  await dialog.save();
  if (harness.operations.length) {
    fail(`saving a tunnel without a change rewrote it: ${harness.operations.join(', ')}`);
  }
  if (harness.uci.get('forkop', 'tunnel_probe', 'name') !== 'wg tunnel') {
    fail('saving a tunnel without a change lost its name');
  }
}

// The backend keeps every server's security saying which mode the protocol runs
// with, including for protocols whose dialog has no field for it. The dialog must
// not undo that: it would be deleted on every save and written back on every
// apply, reporting a change nobody made.
async function checkServerSecuritySurvives() {
  const harness = createHarness(root);
  const serverView = harness.load('server');
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
  serverView.createServerContent(section);
  section.cfgsections = () => ['server_probe'];
  await section.load();
  const security = section.children.find((option) => option.option === 'security');
  if (!security) {
    fail('the server dialog no longer has a security field');
    return;
  }
  if (security.isActive('server_probe')) {
    fail('a mixed server now shows a security field, so this checks nothing');
  }
  await Promise.all(
    section.children.map((option) =>
      Promise.resolve().then(() => option.parse('server_probe')).catch(() => {}),
    ),
  );
  if (harness.uci.get('forkop', 'server_probe', 'security') !== 'none') {
    fail('saving a mixed server dropped the security the backend keeps for it');
  }
}

// Everything above starts from a configuration a test wrote by hand, so it only
// ever asks the question of the options that configuration happens to fill. This
// asks it of every option a form shows: the values come from the form itself -
// fill every field, save, then open and save again and expect nothing.
//
// Only the field that picks the state - the action of a section, the protocol of
// a server - is held back, so each state is reached once. Everything else is
// filled and LuCI decides which of them are shown; a field it hides writes
// nothing in either pass, so the two passes see the same form.
function probeFormValue(option) {
  const cls = option.__name__ || '';
  const choices = (option.keylist || []).filter((key) => `${key ?? ''}` !== '');
  const other = choices.filter((key) => `${key}` !== `${option.default}`);
  const pick = other.length ? `${other[0]}` : choices.length ? `${choices[0]}` : '';
  if (cls === 'CBI.FlagValue') return `${option.default}` === '1' ? '0' : '1';
  if (cls === 'CBI.DynamicList' || cls === 'CBI.MultiValue') {
    return [pick || 'probe-value'];
  }
  if (pick) return pick;
  if (/port/.test(`${option.datatype ?? ''}`) || /_port$/.test(option.option)) return '18080';
  if (/range|uinteger/.test(`${option.datatype ?? ''}`)) return '1280';
  return 'probe-value';
}

async function parseEveryOption(section, sid) {
  for (const option of section.children) {
    await Promise.resolve()
      .then(() => option.parse(sid))
      .catch(() => {});
  }
}

async function checkEveryShownOptionRoundTrips(label, build, states, selector) {
  for (const state of states) {
    const { harness, section, sid } = build(state);
    section.cfgsections = () => [sid];
    await section.load();

    // Fill in every field, the way a user filling the whole dialog would.
    const filled = [];
    for (const option of section.children) {
      if (option.option === selector || option.option === 'enabled') continue;
      if (['CBI.DummyValue', 'CBI.ButtonValue'].includes(option.__name__)) continue;
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
    if (harness.operations.length) {
      fail(
        `${label} ${state}: saving a configuration this form wrote, without a change, ` +
          `rewrote it: ${harness.operations.join(', ')}`,
      );
    }
    if (filled.length < 3) {
      fail(`${label} ${state}: only ${filled.length} fields were filled, so this checks nothing`);
    }
  }
}

async function checkFilledFormsRoundTrip() {
  const buildSection = (action) => {
    const harness = createHarness(root);
    const view = harness.load('section');
    harness.uci.add('forkop', 'section', 'probe');
    Object.assign(harness.store.get('probe'), { action, enabled: '1', label: 'Probe' });
    const map = new harness.form.Map('forkop');
    const grid = map.section(harness.form.GridSection, 'section');
    view.configureSectionSection(grid);
    // The table's load() skips the modal-only options; the dialog loads them all.
    delete grid.load;
    view.createSectionContent(grid);
    return { harness, section: grid, sid: 'probe' };
  };

  const buildServer = (protocol) => {
    const harness = createHarness(root);
    const view = harness.load('server');
    harness.uci.add('forkop', 'server', 'probe');
    Object.assign(harness.store.get('probe'), { protocol, enabled: '1', label: 'Probe' });
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
    return { harness, section: grid, sid: 'probe' };
  };

  const buildSettings = () => {
    const harness = createHarness(root);
    const view = harness.load('settings');
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
    return { harness, section: settings, sid: 'settings' };
  };

  // Every action and every protocol the dropdowns offer, so the fields of each
  // one are filled and asked the question.
  const choicesOf = async (build, seed, name) => {
    const { section, sid } = build(seed);
    section.cfgsections = () => [sid];
    await section.load();
    return (section.children.find((option) => option.option === name)?.keylist || []).slice();
  };
  const actions = await choicesOf(buildSection, 'connection', 'action');
  const protocols = await choicesOf(buildServer, 'mixed', 'protocol');
  if (actions.length < 4 || protocols.length < 10) {
    fail(`the action or protocol list came up short: ${actions.length} and ${protocols.length}`);
  }

  await checkEveryShownOptionRoundTrips('a section', buildSection, actions, 'action');
  await checkEveryShownOptionRoundTrips('a server', buildServer, protocols, 'protocol');
  await checkEveryShownOptionRoundTrips('the Settings page', buildSettings, [''], null);
}

(async () => {
  await checkFilledFormsRoundTrip();
  await checkChildDialogs();
  await checkRuleSetsSurviveEveryAction();
  await checkTunnelRoundTrip();
  await checkShippedSettings();
  await checkSubscriptionTag();
  await checkServerSecuritySurvives();
  if (problems.length) {
    problems.forEach((problem) => console.error(`FAIL: ${problem}`));
    process.exit(1);
  }
  console.log('LuCI settings dialog round-trip checks passed');
})().catch((error) => {
  console.error(`FAIL: ${error && error.stack}`);
  process.exit(1);
});
NODE
