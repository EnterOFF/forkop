import { E } from '../../../helpers/element';
import { renderXIcon24 } from '../../../icons';

export interface ConnectionListItem {
  id: string;
  host: string;
  source: string;
  sourceCopyValue: string;
  route: string;
  network: string;
  time: string;
  download: string;
  upload: string;
  closing: boolean;
}

// The list is built from divs with the table roles rather than from <table>.
// A theme may claim any <table> with a header row as its own data table:
// footstrap does, and lays it out as its own cards with !important declarations
// that no rule outside its cascade layers can override, on top of the cards
// this page draws itself.
function renderList(rows: HTMLElement[]) {
  return E('div', { class: 'fkp_monitoring-page__list', role: 'table' }, [
    E(
      'div',
      {
        class: 'fkp_monitoring-page__row fkp_monitoring-page__row--head',
        role: 'row',
      },
      [
        renderHeading('host', _('Host')),
        renderHeading('source', _('Source')),
        renderHeading('route', _('Route')),
        renderHeading('network', _('Type')),
        renderHeading('time', _('Time')),
        renderHeading('download', `↓ ${_('Downloaded')}`),
        renderHeading('upload', `↑ ${_('Uploaded')}`),
        E('div', {
          class: cellClass('action'),
          role: 'columnheader',
          'aria-label': _('Close'),
        }),
      ],
    ),
    ...rows,
  ]);
}

function cellClass(column: string) {
  return `fkp_monitoring-page__cell fkp_monitoring-page__cell--${column}`;
}

function renderHeading(column: string, text: string) {
  return E('div', { class: cellClass(column), role: 'columnheader' }, text);
}

function renderCell(column: string, children: Node[]) {
  return E('div', { class: cellClass(column), role: 'cell' }, children);
}

function renderValue(text: string, className = '', copyValue = text) {
  const value = text || '-';

  return E(
    'span',
    {
      class: ['fkp_monitoring-page__value', className]
        .filter(Boolean)
        .join(' '),
      title: copyValue || value,
      'data-copy-value': copyValue || value,
    },
    value,
  );
}

function renderAction(item: ConnectionListItem, closable: boolean) {
  if (!closable) {
    return E('span', { class: 'fkp_monitoring-page__action-placeholder' }, '-');
  }

  return E(
    'button',
    {
      class: 'btn cbi-button fkp_monitoring-page__row-action',
      title: _('Close connection'),
      'aria-label': _('Close connection'),
      type: 'button',
      value: item.id,
      ...(item.closing ? { disabled: true } : {}),
    },
    [renderXIcon24()],
  );
}

function renderRow(item: ConnectionListItem, closable: boolean) {
  return E(
    'div',
    {
      class: [
        'fkp_monitoring-page__row',
        item.closing ? 'fkp_monitoring-page__row--closing' : '',
      ]
        .filter(Boolean)
        .join(' '),
      role: 'row',
    },
    [
      renderCell('host', [renderValue(item.host)]),
      renderCell('source', [
        renderValue(item.source, '', item.sourceCopyValue),
      ]),
      renderCell('route', [
        renderValue(item.route, 'fkp_monitoring-page__route'),
      ]),
      renderCell('network', [
        renderValue(item.network, 'fkp_monitoring-page__network'),
      ]),
      renderCell('time', [renderValue(item.time)]),
      renderCell('download', [renderValue(item.download)]),
      renderCell('upload', [renderValue(item.upload)]),
      renderCell('action', [renderAction(item, closable)]),
    ],
  );
}

export function renderConnectionList(
  items: ConnectionListItem[],
  options: { closable: boolean },
) {
  return renderList(items.map((item) => renderRow(item, options.closable)));
}

export function renderConnectionListState(text: string, className = '') {
  return renderList([
    E(
      'div',
      {
        class: 'fkp_monitoring-page__row fkp_monitoring-page__row--state',
        role: 'row',
      },
      [
        E(
          'div',
          {
            class: ['fkp_monitoring-page__state', className]
              .filter(Boolean)
              .join(' '),
            role: 'cell',
          },
          text,
        ),
      ],
    ),
  ]);
}
