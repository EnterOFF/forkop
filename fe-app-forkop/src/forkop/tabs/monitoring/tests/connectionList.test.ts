import { describe, expect, it, vi } from 'vitest';

import type { ConnectionListItem } from '../connectionList';

interface Drawn {
  tag: string;
  attrs: Record<string, unknown>;
  children: Array<Drawn | string>;
}

vi.stubGlobal(
  'E',
  (
    tag: string,
    attrs: Record<string, unknown> = {},
    children: unknown = [],
  ) => ({
    tag,
    attrs,
    children: Array.isArray(children) ? children : [children],
  }),
);
vi.mock('../../../../icons', () => ({
  renderXIcon24: () => ({ tag: 'svg', attrs: {}, children: [] }),
}));

const { renderConnectionList, renderConnectionListState } = await import(
  '../connectionList'
);

const draw = (node: unknown) => node as Drawn;

function elements(node: Drawn): Drawn[] {
  return [
    node,
    ...node.children.flatMap((child) =>
      typeof child === 'string' ? [] : elements(child),
    ),
  ];
}

function text(node: Drawn): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : text(child)))
    .join('');
}

function withRole(node: Drawn, role: string) {
  return elements(node).filter((element) => element.attrs.role === role);
}

function classes(node: Drawn): string[] {
  return String(node.attrs.class ?? '').split(/\s+/);
}

const CONNECTION: ConnectionListItem = {
  id: 'c-1',
  host: 'g.whatsapp.net:5222',
  source: 'POCO-F7',
  sourceCopyValue: 'POCO-F7',
  route: 'Proxy',
  network: 'tcp',
  time: '0:40',
  download: '2.46 KB',
  upload: '2.19 KB',
  closing: false,
};

describe('the Monitoring connection list', () => {
  // footstrap claims every <table> with a header row, and every element with
  // LuCI's .table class, as its own data table and cards it over this page's
  // own layout (its fs-select.js, "Rule 8" of its third-party-apps.md).
  it('is nothing a theme can claim as a data table', () => {
    const list = draw(renderConnectionList([CONNECTION], { closable: true }));

    expect(
      elements(list).filter(
        (element) =>
          ['table', 'thead', 'tbody', 'tr', 'th', 'td'].includes(element.tag) ||
          classes(element).includes('table'),
      ),
    ).toEqual([]);
    expect(list.attrs.role).toBe('table');
  });

  it('puts every value under the heading of its column', () => {
    const list = draw(renderConnectionList([CONNECTION], { closable: true }));
    const [head, row] = withRole(list, 'row');

    expect(withRole(head, 'columnheader').map(text)).toEqual([
      'Host',
      'Source',
      'Route',
      'Type',
      'Time',
      '↓ Downloaded',
      '↑ Uploaded',
      '',
    ]);
    expect(withRole(row, 'cell').map(text)).toEqual([
      'g.whatsapp.net:5222',
      'POCO-F7',
      'Proxy',
      'tcp',
      '0:40',
      '2.46 KB',
      '2.19 KB',
      '',
    ]);
  });

  it('closes a connection by its id, once', () => {
    const [open, closing] = [
      CONNECTION,
      { ...CONNECTION, id: 'c-2', closing: true },
    ].map((item) =>
      elements(draw(renderConnectionList([item], { closable: true }))).find(
        (element) => element.tag === 'button',
      ),
    );

    expect(open?.attrs.value).toBe('c-1');
    expect(open?.attrs.disabled).toBeUndefined();
    expect(closing?.attrs.value).toBe('c-2');
    expect(closing?.attrs.disabled).toBe(true);
  });

  it('offers nothing to close on a connection that is already closed', () => {
    const list = draw(renderConnectionList([CONNECTION], { closable: false }));

    expect(elements(list).some((element) => element.tag === 'button')).toBe(
      false,
    );
  });

  it('copies the whole source, not the name it shows', () => {
    const list = draw(
      renderConnectionList(
        [
          {
            ...CONNECTION,
            source: 'Office (alice)',
            sourceCopyValue: 'Office (alice)',
          },
          { ...CONNECTION, source: '', sourceCopyValue: '' },
        ],
        { closable: true },
      ),
    );
    const sources = withRole(list, 'cell')
      .filter((cell) =>
        classes(cell).includes('fkp_monitoring-page__cell--source'),
      )
      .map((cell) => draw(cell.children[0]).attrs['data-copy-value']);

    expect(sources).toEqual(['Office (alice)', '-']);
  });

  it('says what it is waiting for in a row of its own', () => {
    const list = draw(renderConnectionListState('Loading connections'));
    const rows = withRole(list, 'row');

    expect(rows).toHaveLength(2);
    expect(withRole(rows[1], 'cell').map(text)).toEqual([
      'Loading connections',
    ]);
  });
});
