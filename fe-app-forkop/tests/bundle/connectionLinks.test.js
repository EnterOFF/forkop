// The links a Connection section dials, driven through the shipped bundle. A
// pasted link is shown and stored under a name rather than as the link itself,
// and its dialog is where the name and the link are changed.
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
    label: 'Proxy',
  });
});

function linkList() {
  const map = new harness.form.Map('forkop');
  const grid = map.section(harness.form.GridSection, 'section');
  delete grid.load;
  harness.bundle.createSectionContent(grid);
  return grid.children.find((option) => option.option === 'connection_link');
}

// What the widget does when the user adds a link: the entry is rendered with its
// label while the list still holds the entries before it, then the list changes.
function paste(list, values, link) {
  const label = list.renderListItemLabel('sec', link).textContent;
  values.push(link);
  list.onListChange('sec', values.slice());
  return label;
}

function storedLinks() {
  return harness.uci
    .sections('forkop', 'connection_link')
    .map(({ section, uri, name, order }) => ({ section, uri, name, order }));
}

describe('a pasted link', () => {
  it('is listed under its own name, a number, or its name and a number', () => {
    const list = linkList();
    const values = [];
    list.formvalue = () => values.slice();

    expect(
      [
        'vless://a@a.example:443#USA',
        'trojan://p@b.example:443',
        'vless://c@c.example:443#USA',
        'vmess://' +
          Buffer.from(
            JSON.stringify({ ps: 'VMess node', add: 'd.example' }),
          ).toString('base64'),
      ].map((link) => paste(list, values, link)),
    ).toEqual(['USA', 'Node #2', 'USA #2', 'VMess node']);
  });

  it('is saved as a link of the section under the name the list shows', async () => {
    const list = linkList();
    const values = [];
    list.formvalue = () => values.slice();
    paste(list, values, 'vless://a@a.example:443#USA');
    paste(list, values, 'trojan://p@b.example:443');

    await list.parse('sec');

    expect(storedLinks()).toEqual([
      {
        section: 'sec',
        uri: 'vless://a@a.example:443#USA',
        name: 'USA',
        order: '0',
      },
      {
        section: 'sec',
        uri: 'trojan://p@b.example:443',
        name: 'Node #2',
        order: '1',
      },
    ]);
  });

  it('typed and saved without being added still gets a name of its own', async () => {
    const list = linkList();
    list.formvalue = () => [
      'vless://a@a.example:443#Same',
      'vless://b@b.example:443#Same',
    ];

    await list.parse('sec');

    expect(storedLinks().map((link) => link.name)).toEqual(['Same', 'Same #2']);
  });

  it('takes the name its dialog gave it before the section is saved', async () => {
    const list = linkList();
    const values = [];
    list.formvalue = () => values.slice();
    const link = 'vless://a@a.example:443#USA';
    paste(list, values, link);

    const dialog = await harness.openDialog(list, 'sec', link);
    const fields = dialog.map.children[0].children;
    fields.find((option) => option.option === 'name').formvalue = () =>
      ' New York ';
    expect((await dialog.save()).saved).toBe(true);
    await list.parse('sec');

    expect(storedLinks()).toEqual([
      { section: 'sec', uri: link, name: 'New York', order: '0' },
    ]);
  });
});

describe('a stored link', () => {
  beforeEach(() => {
    harness.uci.add('forkop', 'connection_link', 'link1');
    Object.assign(harness.store.get('link1'), {
      section: 'sec',
      uri: 'vless://a@a.example:443#USA',
      name: 'USA',
      order: '0',
    });
  });

  it('is listed under its stored name', () => {
    expect(linkList().renderListItemLabel('sec', 'link1').textContent).toBe(
      'USA',
    );
  });

  it('changes its link and its name in its dialog', async () => {
    const list = linkList();
    const dialog = await harness.openDialog(list, 'sec', 'link1');
    const fields = dialog.map.children[0].children;
    const field = (name) => fields.find((option) => option.option === name);
    expect(dialog.map.data.get(dialog.map.config, 'settings', 'uri')).toBe(
      'vless://a@a.example:443#USA',
    );
    expect(field('uri').password, 'the link is shown masked').toBe(true);
    field('uri').formvalue = () => 'trojan://p@b.example:443#Other';
    field('name').formvalue = () => 'Chicago';

    expect((await dialog.save()).saved).toBe(true);
    expect(storedLinks()).toEqual([
      {
        section: 'sec',
        uri: 'trojan://p@b.example:443#Other',
        name: 'Chicago',
        order: '0',
      },
    ]);
  });

  // The widget checks a field as it is typed in, so its check is what keeps a
  // link the core cannot dial out of the dialog.
  it('refuses an empty link and one the core cannot dial', async () => {
    harness.bundle.setCoreFeatures(coreFeatures({ remove: ['with_quic'] }));
    const dialog = await harness.openDialog(linkList(), 'sec', 'link1');
    const fields = dialog.map.children[0].children;
    const check = (name, value) =>
      fields.find((option) => option.option === name).validate('link1', value);

    expect(check('uri', 'hy2://p@b.example:443#H')).toBe(
      'The installed sing-box was built without with_quic',
    );
    expect(check('uri', ' ')).toBe('Paste a connection URI');
    expect(check('uri', 'vless://a@a.example:443#USA')).toBe(true);
    expect(check('name', '')).toBe('Enter a display name');
  });
});
