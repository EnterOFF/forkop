// The subscriptions of a Connection section, driven through the shipped bundle.
// A pasted address is a subscription of its own from the moment it is added, the
// list shows it by its tag, and its dialog is where the address is changed,
// between a URL and a local file included.
import { beforeEach, describe, expect, it } from 'vitest';

import { coreFeatures } from '../lib/coreFeatures.js';
import { createHarness } from '../lib/luciForm.js';

const DEFAULT_HEADERS = ['User-Agent: forkop-test'];

let harness;

beforeEach(() => {
  harness = createHarness();
  harness.bundle.setCoreFeatures(coreFeatures());
  harness.commands.get_subscription_default_headers = () =>
    Promise.resolve({ code: 0, stdout: JSON.stringify(DEFAULT_HEADERS) });
  harness.uci.add('forkop', 'section', 'sec');
  Object.assign(harness.store.get('sec'), {
    action: 'connection',
    enabled: '1',
    label: 'Proxy',
  });
});

function subscriptionList() {
  const map = new harness.form.Map('forkop');
  const grid = map.section(harness.form.GridSection, 'section');
  delete grid.load;
  harness.bundle.createSectionContent(grid);
  return grid.children.find((option) => option.option === 'subscription_url');
}

// What the widget does when the user adds an address: the address becomes its
// subscription, and the entry holding its id is rendered with its label.
function paste(list, values, source) {
  const itemId = list.createTypedItem('sec', source);
  const label = list.renderListItemLabel('sec', itemId).textContent;
  values.push(itemId);
  return label;
}

function storeSubscription(id, values) {
  harness.uci.add('forkop', 'subscription_url', id);
  Object.assign(harness.store.get(id), { section: 'sec', ...values });
}

// The list holds what the section dialog shows, which a check in the
// subscription dialog reads; without a widget the stored entries stand in.
async function openSubscription(id, listed) {
  const list = subscriptionList();
  if (listed) list.formvalue = () => listed;
  const dialog = await harness.openDialog(list, 'sec', id);
  const fields = dialog.map.children[0].children;
  return {
    title: dialog.title,
    field: (name) => fields.find((option) => option.option === name),
    set(name, value) {
      this.field(name).formvalue = () => value;
    },
    save: () => dialog.save(),
  };
}

const REMOTE = {
  url: 'https://example.com/sub',
  tag: 'sub1',
  server_filter_mode: 'all',
  subscription_update_enabled: '1',
  subscription_update_interval: '1h',
  download_via_proxy_enabled: '0',
  header: ['User-Agent: custom'],
  show_dashboard_metadata: '1',
};

describe('the subscription list', () => {
  it('shows a pasted subscription by the tag it is given', () => {
    const list = subscriptionList();
    const values = [];
    list.formvalue = () => values.slice();
    const labels = ['https://a.example/sub', '/etc/forkop/b.txt'].map(
      (source) => paste(list, values, source),
    );

    expect(labels).toEqual(['sub1', 'sub2']);
  });

  // The same account split by two filters, or fetched through two cascades, is
  // the same address added twice, and each is a provider of its own.
  it('adds the same address twice as two subscriptions', async () => {
    // The Sections table loads the default headers before any dialog opens.
    const map = new harness.form.Map('forkop');
    const grid = map.section(harness.form.GridSection, 'section');
    harness.bundle.configureSectionSection(grid);
    harness.bundle.createSectionContent(grid);
    grid.cfgsections = () => ['sec'];
    await grid.load();
    const list = grid.children.find(
      (option) => option.option === 'subscription_url',
    );
    list.cfgvalue('sec', list.load('sec'));
    const values = [];
    list.formvalue = () => values.slice();
    const source = 'https://a.example/sub';

    expect([paste(list, values, source), paste(list, values, source)]).toEqual([
      'sub1',
      'sub2',
    ]);
    await list.parse('sec');

    expect(
      harness.uci
        .sections('forkop', 'subscription_url')
        .map(({ section, url, tag, header }) => ({
          section,
          url,
          tag,
          header,
        })),
    ).toEqual([
      { section: 'sec', url: source, tag: 'sub1', header: DEFAULT_HEADERS },
      { section: 'sec', url: source, tag: 'sub2', header: DEFAULT_HEADERS },
    ]);
  });

  it('shows a stored subscription by its tag', () => {
    storeSubscription('sub_a', { ...REMOTE, tag: 'premium' });

    expect(
      subscriptionList().renderListItemLabel('sec', 'sub_a').textContent,
    ).toBe('premium');
  });
});

describe('the address in the subscription dialog', () => {
  it('moves a subscription to another URL and keeps how it is fetched', async () => {
    storeSubscription('sub_a', REMOTE);
    const dialog = await openSubscription('sub_a');
    expect(dialog.field('url').password, 'the URL is shown masked').toBe(true);
    expect(dialog.title).toBe('Subscription: sub1');
    dialog.set('url', 'https://other.example/sub');

    expect((await dialog.save()).saved).toBe(true);
    expect(harness.store.get('sub_a')).toMatchObject({
      ...REMOTE,
      url: 'https://other.example/sub',
    });
  });

  it('drops what only a URL is fetched with when it becomes a local file', async () => {
    storeSubscription('sub_a', REMOTE);
    const dialog = await openSubscription('sub_a');
    dialog.set('url', '/etc/forkop/sub.txt');

    expect((await dialog.save()).saved).toBe(true);
    const stored = harness.store.get('sub_a');
    expect(stored.url).toBe('/etc/forkop/sub.txt');
    for (const key of [
      'subscription_update_enabled',
      'subscription_update_interval',
      'download_via_proxy_enabled',
      'header',
      'show_dashboard_metadata',
    ])
      expect(stored[key], key).toBeUndefined();
    expect(stored.tag).toBe('sub1');
  });

  it('gives a local file that becomes a URL the defaults a new one gets', async () => {
    storeSubscription('sub_a', {
      url: '/etc/forkop/sub.txt',
      tag: 'sub1',
      server_filter_mode: 'all',
    });
    const dialog = await openSubscription('sub_a');
    dialog.set('url', 'https://example.com/sub');

    expect((await dialog.save()).saved).toBe(true);
    expect(harness.store.get('sub_a')).toMatchObject({
      url: 'https://example.com/sub',
      subscription_update_enabled: '1',
      subscription_update_interval: '1h',
      header: DEFAULT_HEADERS,
      show_dashboard_metadata: '1',
    });
  });

  it('takes the address another subscription of the section has', async () => {
    storeSubscription('sub_a', REMOTE);
    storeSubscription('sub_b', {
      ...REMOTE,
      url: 'https://b.example/sub',
      tag: 'sub2',
    });
    const dialog = await openSubscription('sub_b', ['sub_a', 'sub_b']);
    const check = (value) => dialog.field('url').validate('sub_b', value);

    expect(check('https://example.com/sub')).toBe(true);
    expect(check('https://b.example/sub')).toBe(true);
    expect(check('')).toBe('Required');
  });
});
