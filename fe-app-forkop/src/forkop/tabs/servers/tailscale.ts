import { E } from '../../../helpers/element';
import { pageLanguage, relativeTime } from '../../../helpers/relativeTime';
import { CustomForkopMethods } from '../../methods';
import { ClashAPI } from '../../types';
import {
  copyWithToast,
  iconSvg,
  injectDetailsStyles,
  renderCloseRow,
} from './details';
import { option } from './formValues';
import { getServerName } from './protocols';

const REFRESH_INTERVAL_MS = 5000;
const STYLE_ID = 'forkop-tailscale-styles';

type Tone = 'ok' | 'warn' | 'error' | 'muted';

type EndpointLoad =
  | { endpoint: ClashAPI.TailscaleEndpoint }
  | { endpoint?: undefined; error?: string };

function injectStyles() {
  injectDetailsStyles();
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  document.head.appendChild(
    E(
      'style',
      { id: STYLE_ID },
      [
        // The URLTest and Fallback details' grid of parameters and rows of nodes.
        '.fkp-ts__params{display:grid;grid-template-columns:minmax(120px,max-content) minmax(0,1fr);gap:8px 16px;margin:0 0 18px}',
        '.fkp-ts__params > div{display:contents}',
        '.fkp-ts__params dt{color:var(--text-color-medium,#666);line-height:1.35}',
        '.fkp-ts__params dd{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;min-inline-size:0;margin:0;overflow-wrap:anywhere}',
        '.fkp-ts__lines{display:grid;gap:4px;min-inline-size:0}',
        '.fkp-ts--ok{color:var(--success-color-medium,green)}',
        '.fkp-ts--warn{color:var(--warn-color-medium,#c80)}',
        '.fkp-ts--error{color:var(--error-color-medium,red)}',
        '.fkp-ts--muted{color:var(--text-color-medium,#666)}',
        '.fkp-ts__pending{font-size:12px}',
        '.fkp-ts__address{color:var(--primary-color-high,#337ab7);text-decoration:none}',
        '.fkp-ts__address:hover{text-decoration:underline}',
        '.fkp-ts__online{display:inline-flex;align-items:center;gap:6px}',
        '.fkp-ts__online::before{content:"";flex:none;inline-size:8px;block-size:8px;border-radius:50%;background:currentColor}',
        '.fkp-ts__devices-title{margin-bottom:8px;font-weight:600}',
        '.fkp-ts__devices{display:grid;gap:6px;max-block-size:min(46vh,460px);overflow-y:auto}',
        '.fkp-ts__device{display:flex;flex-wrap:wrap;align-items:center;column-gap:8px;row-gap:2px;padding:7px 8px;border-bottom:1px solid var(--border-color-low,#eee)}',
        '.fkp-ts__device-name{display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;flex:1 1 auto;min-inline-size:0}',
        '.fkp-ts__device-name b{overflow-wrap:anywhere}',
        '.fkp-ts__device-name > svg{flex:none;inline-size:14px;block-size:14px;color:var(--text-color-medium,#888)}',
        '.fkp-ts__device-meta{display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;flex:0 1 auto;margin-left:auto}',
      ].join('\n'),
    ),
  );
}

function formatDate(seconds: number) {
  return new Date(seconds * 1000).toLocaleDateString(pageLanguage(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function text(tone: Tone, value: string, title?: string) {
  return E(
    'span',
    title ? { class: `fkp-ts--${tone}`, title } : { class: `fkp-ts--${tone}` },
    value,
  );
}

function online() {
  return E('span', { class: 'fkp-ts--ok fkp-ts__online' }, _('Online'));
}

function renderStatus(endpoint: ClashAPI.TailscaleEndpoint) {
  switch (endpoint.state) {
    case 'Running':
      return endpoint.connected
        ? [online()]
        : [text('error', _('No connection to the coordination server'))];
    case 'NeedsLogin':
      return [
        text('warn', _('Waiting for sign-in')),
        ...(endpoint.authURL
          ? [
              E(
                'a',
                {
                  href: endpoint.authURL,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                },
                _('Sign in'),
              ),
            ]
          : []),
      ];
    case 'NeedsMachineAuth':
      return [text('warn', _('Waiting for approval in the console'))];
    case 'Stopped':
      return [text('muted', _('Stopped'))];
    default:
      return [text('muted', _('Starting'))];
  }
}

function approval(approved: boolean) {
  return approved
    ? text('ok', _('Approved'))
    : E(
        'span',
        { class: 'fkp-ts--warn fkp-ts__pending' },
        _('Waiting for approval in the console'),
      );
}

function renderKeyExpiry(keyExpiry?: number) {
  if (!keyExpiry) {
    return text('muted', _('Does not expire'));
  }
  return keyExpiry * 1000 < Date.now()
    ? text('error', _('Expired %s').format(formatDate(keyExpiry)))
    : E('span', {}, _('Expires %s').format(formatDate(keyExpiry)));
}

// Each address copies itself when clicked.
function renderAddresses(addresses: string[]) {
  return addresses.flatMap((address, index) => [
    ...(index ? [text('muted', '·')] : []),
    E(
      'a',
      {
        href: '#',
        class: 'fkp-ts__address',
        title: _('Copy'),
        click: (ev: Event) => {
          ev.preventDefault();
          copyWithToast(address);
        },
      },
      address,
    ),
  ]);
}

function param(label: string, children: Array<Node | string>) {
  return E('div', {}, [E('dt', {}, label), E('dd', {}, children)]);
}

function renderParams(endpoint: ClashAPI.TailscaleEndpoint) {
  const running = endpoint.state === 'Running';
  const params = [param(_('Status'), renderStatus(endpoint))];

  if (endpoint.name) {
    params.push(param(_('Name in the console'), [endpoint.name]));
  }
  if (endpoint.addresses.length) {
    params.push(param(_('Addresses'), renderAddresses(endpoint.addresses)));
  }
  if (endpoint.tailnet) {
    params.push(param(_('Tailnet'), [endpoint.tailnet]));
  }
  if (endpoint.advertisesExitNode && running) {
    params.push(param(_('Exit node'), [approval(endpoint.exitNodeApproved)]));
  }
  if (endpoint.routes.length) {
    params.push(
      param(_('Advertise routes'), [
        E(
          'div',
          { class: 'fkp-ts__lines' },
          endpoint.routes.map((route) =>
            E('div', {}, [`${route.prefix} · `, approval(route.approved)]),
          ),
        ),
      ]),
    );
  }
  if (running) {
    params.push(param(_('Node key'), [renderKeyExpiry(endpoint.keyExpiry)]));
  }
  if (endpoint.health.length) {
    params.push(
      param(_('Warnings'), [
        E(
          'div',
          { class: 'fkp-ts__lines' },
          endpoint.health.map((message) => E('div', {}, message)),
        ),
      ]),
    );
  }

  return E('dl', { class: 'fkp-ts__params' }, params);
}

function renderPeerMeta(peer: ClashAPI.TailscalePeer) {
  if (!peer.online) {
    return [
      text(
        'muted',
        peer.lastSeen
          ? _('Offline, seen %s').format(relativeTime(peer.lastSeen))
          : _('Offline'),
      ),
    ];
  }
  return [text('ok', _('Online now'))];
}

function renderPeer(peer: ClashAPI.TailscalePeer, showUser: boolean) {
  return E('div', { class: 'fkp-ts__device', title: peer.dnsName || '' }, [
    E('div', { class: 'fkp-ts__device-name' }, [
      iconSvg('user'),
      E('b', {}, peer.name),
      ...(peer.addresses[0] ? [text('muted', peer.addresses[0])] : []),
      ...(showUser && peer.user ? [text('muted', peer.user)] : []),
    ]),
    E('div', { class: 'fkp-ts__device-meta' }, renderPeerMeta(peer)),
  ]);
}

function renderPeers(peers: ClashAPI.TailscalePeer[]) {
  const showUser = new Set(peers.map((peer) => peer.user)).size > 1;

  return E('div', {}, [
    E('div', { class: 'fkp-ts__devices-title' }, _('Devices')),
    peers.length
      ? E(
          'div',
          { class: 'fkp-ts__devices' },
          peers.map((peer) => renderPeer(peer, showUser)),
        )
      : E(
          'div',
          { class: 'fkp-details__empty' },
          _('No other devices in the tailnet'),
        ),
  ]);
}

function renderUnavailable(sectionId: string, load: EndpointLoad) {
  let message: string;
  if (load.endpoint === undefined && load.error) {
    message = _('Failed to get the Tailscale state: %s').format(load.error);
  } else if (option(sectionId, 'enabled') === '0') {
    message = _('The server is disabled.');
  } else {
    message = _(
      'The server is not running yet. Apply the settings, or start Forkop.',
    );
  }
  return E('div', { class: 'fkp-details__empty' }, message);
}

export function renderTailscaleContent(sectionId: string, load: EndpointLoad) {
  if (!load.endpoint) {
    return [renderUnavailable(sectionId, load)];
  }
  return [
    renderParams(load.endpoint),
    ...(load.endpoint.state === 'Running'
      ? [renderPeers(load.endpoint.peers)]
      : []),
  ];
}

export async function loadTailscaleEndpoint(
  tag: string,
): Promise<EndpointLoad> {
  const response = await CustomForkopMethods.getClashApiTailscale();
  if (!response.success) {
    return { error: response.error };
  }
  const endpoint = response.data?.endpoints?.find((item) => item.tag === tag);
  return endpoint ? { endpoint } : {};
}

// Refreshed while the dialog stays open: a device coming online, an approval in the console.
export function showTailscaleDetailsModal(sectionId: string) {
  injectStyles();
  const tag = getServerName(sectionId);
  const content = E('div', { class: 'fkp-details' }, [
    E('em', { class: 'spinning' }, _('Loading…')),
  ]);
  ui.showModal(_('Server details: %s').format(tag), [
    content,
    renderCloseRow(),
  ]);

  let timer = 0;
  const refresh = () =>
    loadTailscaleEndpoint(tag).then((load) => {
      if (!document.body.contains(content)) {
        window.clearInterval(timer);
        return;
      }
      dom.content(content, renderTailscaleContent(sectionId, load));
    });
  void refresh();
  timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
}
