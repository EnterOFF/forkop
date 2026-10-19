import { showToast } from '../../../helpers/showToast';
import {
  buildClientLinks,
  hasRequiredCredentials,
  loadLinkContext,
} from './links';
import { getListenPort, getPublicHost } from './network';
import { loadIssuedMaterial } from './issued';
import type { IssuedMaterial } from './issued';
import { buildClientProfile, downloadProfile } from './profile';
import {
  getProtocol,
  getServerName,
  isAuthenticationEnabled,
  usesProfile,
} from './protocols';
import { qrCode } from './qr';
import { E } from '../../../helpers/element';

function svgEl(
  tag: string,
  attrs: Record<string, string> = {},
  children: Node[] = [],
) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value != null) {
      element.setAttribute(key, `${value}`);
    }
  });
  (Array.isArray(children) ? children : [children])
    .filter(Boolean)
    .forEach((child) => element.appendChild(child));
  return element;
}

type IconPath = [string, Record<string, string>];

// Lucide outlines at the size and stroke the rest of Forkop already uses.
const ICON_PATHS: Record<string, IconPath[]> = {
  generate: [
    ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
    ['path', { d: 'M3 3v5h5' }],
  ],
  copy: [
    ['rect', { x: '9', y: '9', width: '13', height: '13', rx: '2', ry: '2' }],
    ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }],
  ],
  qr: [
    ['rect', { x: '3', y: '3', width: '7', height: '7', rx: '1' }],
    ['rect', { x: '14', y: '3', width: '7', height: '7', rx: '1' }],
    ['rect', { x: '3', y: '14', width: '7', height: '7', rx: '1' }],
    ['path', { d: 'M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1' }],
  ],
  info: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M12 16v-4' }],
    ['path', { d: 'M12 8h.01' }],
  ],
  user: [
    ['path', { d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: '12', cy: '7', r: '4' }],
  ],
  file: [
    [
      'path',
      { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' },
    ],
    ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }],
    ['path', { d: 'M16 13H8' }],
    ['path', { d: 'M16 17H8' }],
    ['path', { d: 'M10 9H8' }],
  ],
  download: [
    ['path', { d: 'M12 15V3' }],
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['path', { d: 'm7 10 5 5 5-5' }],
  ],
};

export function iconSvg(name: string) {
  return svgEl(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: '16',
      height: '16',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    ICON_PATHS[name].map(([tag, attrs]) => svgEl(tag, attrs)),
  );
}

function copyText(text: string) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (error) {
    console.warn('Failed to copy the client link', error);
  }

  document.body.removeChild(textarea);
  return copied;
}

const DETAILS_STYLE_ID = 'forkop-server-details-styles';

function injectDetailsStyles() {
  if (document.getElementById(DETAILS_STYLE_ID)) {
    return;
  }

  document.head.appendChild(
    E(
      'style',
      { id: DETAILS_STYLE_ID },
      [
        // The summary is the same dl/dt/dd the URLTest and Fallback details build, not
        // a grid of spans dressed to look like one. Half of how those labels read comes
        // from the theme through the tag - dl dt is bold at line-height 18px - so
        // copying their class rules onto other elements could never match them.
        // The width comes from the same place too: all three are opened without
        // cbi-modal, which is what the theme widens to a settings form.
        '.fkp-details{box-sizing:border-box;width:min(760px,calc(100vw - 56px));max-width:100%;padding-top:10px}',
        // A profile is a short file name and three buttons, so its dialog is
        // narrower than the 760px a link needs, though not as narrow as they are.
        '#modal_overlay > .modal.fkp-details-modal--profiles{width:fit-content}',
        '.fkp-details--profiles{width:min(480px,calc(100vw - 56px))}',
        // The clients one under another, each its name over what it is given; the
        // name and its icon set one client off from the next. A column of names
        // beside the links put the Close button under the last name, where it
        // read as one more of them.
        '.fkp-details__client{display:grid;gap:6px;min-inline-size:0;padding-block:8px}',
        '.fkp-details__client:first-child{padding-top:0}',
        '.fkp-details__client:last-child{padding-bottom:0}',
        '.fkp-details__name{display:flex;align-items:center;gap:6px;min-inline-size:0;font-weight:600}',
        '.fkp-details__name > svg{flex:none;inline-size:14px;block-size:14px;color:var(--text-color-medium,#888)}',
        '.fkp-details__name > span{min-inline-size:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.fkp-details__links{display:grid;gap:6px;min-inline-size:0}',
        '.fkp-details__link{display:grid;grid-template-columns:minmax(0,1fr);grid-auto-flow:column;grid-auto-columns:auto;gap:4px;align-items:stretch;min-inline-size:0}',
        // A profile is a file, not a value to read or select: its name behind a file
        // icon, in a tile the size and outline of the field a link has, filled so
        // it does not read as one to type in.
        '.fkp-details__file{display:flex;align-items:center;gap:6px;box-sizing:border-box;min-inline-size:0;min-block-size:30px;padding:0 8px;border:1px solid var(--border-color-high,rgba(128,128,128,.4));border-radius:3px;background:var(--background-color-low,rgba(128,128,128,.08))}',
        '.fkp-details__file > svg{flex:none;color:var(--text-color-medium,#888)}',
        '.fkp-details__file > span{min-inline-size:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.fkp-details__value{inline-size:100% !important;max-inline-size:100% !important;min-inline-size:0;box-sizing:border-box;margin:0 !important;float:none !important;font-family:monospace;font-size:12px}',
        '.fkp-details__action{display:inline-flex;align-items:center;justify-content:center;inline-size:2.5em !important;min-inline-size:0;padding:0 !important;margin:0 !important;float:none !important;line-height:1}',
        '.fkp-details__empty{color:var(--text-color-medium,#666)}',
        // The theme lays a modal button row out as space-between and gives the first
        // button a margin-right of auto, so where a lone button lands is the theme's
        // choice rather than this dialog's. These two rules make it the dialog's: at
        // the left of the row, the same place as in the URLTest and Fallback details.
        // A bare class loses to both of the theme's selectors, so the override
        // extends the same ones.
        '.modal > .button-row.fkp-details-actions{justify-content:flex-start;gap:0.5em}',
        '.modal > .button-row.fkp-details-actions > button:first-of-type{margin-right:0}',
        // The dialog is as wide as the code, and everything under the code fits that
        // width: 16rem, or three pixels a module for a code as large as a profile's.
        // The white edge is the code's own quiet zone, the four modules the standard
        // asks for and nothing more, with the 4px corners of every block on the page.
        '#modal_overlay > .modal.fkp-qr-modal{width:fit-content}',
        '.fkp-qr{display:grid;justify-items:center;gap:12px;inline-size:min(max(16rem,var(--fkp-qr-size,0px)),calc(100vw - 64px));padding-top:8px}',
        '.fkp-qr__code{display:block;box-sizing:border-box;inline-size:100%;block-size:auto;aspect-ratio:1;background:#fff;border-radius:4px}',
        '.fkp-qr__caption{display:grid;justify-items:center;gap:2px;max-inline-size:100%;text-align:center}',
        '.fkp-qr__name{font-weight:600;overflow-wrap:anywhere}',
        '.fkp-qr__details{color:var(--text-color-medium,#666);font-size:12px;overflow-wrap:anywhere}',
        '.fkp-qr > .fkp-details__link{justify-self:stretch}',
      ].join('\n'),
    ),
  );
}

// A copy control stays a copy control: the toast says what happened, and swapping
// the icon for a tick is not something the rest of the app does.
function renderCopyButton(value: string, label = _('Copy')) {
  const button = E(
    'button',
    {
      class: 'btn cbi-button cbi-button-neutral fkp-details__action',
      type: 'button',
      title: label,
      'aria-label': label,
    },
    iconSvg('copy'),
  );

  button.addEventListener('click', (ev) => {
    ev.preventDefault();
    const copied = copyText(value);
    showToast(
      copied ? _('Copied') : _('Failed to copy!'),
      copied ? 'success' : 'error',
    );
  });

  return button;
}

function renderCloseRow() {
  return E('div', { class: 'button-row fkp-details-actions' }, [
    E(
      'button',
      {
        class: 'btn cbi-button cbi-button-neutral',
        type: 'button',
        click: () => ui.hideModal(),
      },
      _('Close'),
    ),
  ]);
}

interface LinkCaption {
  name: string;
  details: string;
}

// The code is shown when it is asked for, at a size a phone can read, with what it
// belongs to under it and what it carries in a row that copies it: the link, or
// the profile with its download.
export function showQrModal(caption: LinkCaption, code: string, row?: Node) {
  injectDetailsStyles();

  const qr = qrCode(code);
  const content = E(
    'div',
    { class: 'fkp-qr', style: `--fkp-qr-size:${qr.size * 3}px` },
    [
      E('img', {
        class: 'fkp-qr__code',
        src: qr.uri,
        alt: _('QR code'),
      }),
      E('div', { class: 'fkp-qr__caption' }, [
        E('div', { class: 'fkp-qr__name' }, caption.name),
        ...(caption.details
          ? [E('div', { class: 'fkp-qr__details' }, caption.details)]
          : []),
      ]),
      row ?? renderLinkRow(code),
    ],
  );

  ui.showModal(_('QR code'), [content, renderCloseRow()], 'fkp-qr-modal');

  return content;
}

function renderQrButton(caption: LinkCaption, code: string, row?: () => Node) {
  const label = _('Show a QR code');
  return E(
    'button',
    {
      class: 'btn cbi-button cbi-button-neutral fkp-details__action',
      type: 'button',
      title: label,
      'aria-label': label,
      click: (ev) => {
        ev.preventDefault();
        showQrModal(caption, code, row?.());
      },
    },
    iconSvg('qr'),
  );
}

// What a code belongs to: the account when there is one, then the server it is on
// and the scheme when the listener answers more than one. A listener that has no
// account is named by the server, and its scheme is what tells its links apart.
export function linkCaption(
  sectionId: string,
  client: ServerClient,
  scheme: string,
): LinkCaption {
  const server = getServerName(sectionId);
  const name = `${client?.name || ''}`.trim();

  return {
    name: name || server,
    details: [name ? server : '', scheme].filter(Boolean).join(' \u00b7 '),
  };
}

function renderLinkRow(value: string, qrCaption?: LinkCaption) {
  const input = E('input', {
    type: 'text',
    class: 'cbi-input-text fkp-details__value',
    readonly: 'readonly',
    spellcheck: 'false',
    value,
  });
  input.addEventListener('focus', () => input.select());

  return E('div', { class: 'fkp-details__link' }, [
    input,
    ...(qrCaption ? [renderQrButton(qrCaption, value)] : []),
    renderCopyButton(value),
  ]);
}

// The profile of a client: its file, saved by one button and copied as text by
// the other. The WireGuard and AmneziaWG apps also scan one
// from a code; an OpenVPN profile fits none a phone can read, and no OpenVPN
// client imports one from a code anyway.
function renderProfileRow(
  profile: string,
  name: string,
  type: string,
  qrCaption?: LinkCaption,
): Node {
  const label = _('Download the profile');
  return E('div', { class: 'fkp-details__link' }, [
    E('div', { class: 'fkp-details__file' }, [
      iconSvg('file'),
      E('span', { title: name }, name),
    ]),
    ...(qrCaption
      ? [
          renderQrButton(qrCaption, profile, () =>
            renderProfileRow(profile, name, type),
          ),
        ]
      : []),
    E(
      'button',
      {
        class: 'btn cbi-button cbi-button-neutral fkp-details__action',
        type: 'button',
        title: label,
        'aria-label': label,
        click: (ev: Event) => {
          ev.preventDefault();
          downloadProfile(profile, name, type);
        },
      },
      iconSvg('download'),
    ),
    renderCopyButton(profile, _('Copy the profile')),
  ]);
}

// One client: its name, and what it is handed. A listener that asks for nothing
// has no account to name, and repeating the name of the server there would say
// nothing, so it has none.
function renderClientRow(name: string, body: Node[]) {
  return E('div', { class: 'fkp-details__client' }, [
    ...(name
      ? [
          E('div', { class: 'fkp-details__name', title: name }, [
            iconSvg('user'),
            E('span', {}, name),
          ]),
        ]
      : []),
    E('div', { class: 'fkp-details__links' }, body),
  ]);
}

function renderProfileDetails(
  sectionId: string,
  client: ServerClient,
  material: IssuedMaterial,
) {
  const result = buildClientProfile(sectionId, client, material);
  const scanned = getProtocol(sectionId) !== 'openvpn';
  return renderClientRow(client.name, [
    'profile' in result
      ? renderProfileRow(
          result.profile,
          result.fileName,
          result.type,
          scanned ? linkCaption(sectionId, client, '') : undefined,
        )
      : E(
          'div',
          { class: 'fkp-details__empty' },
          result.missing === 'address'
            ? _('Set the public host and the port to get a profile.')
            : result.missing === 'keys'
              ? _(
                  'The router issues the keys of this client when the settings are applied. Apply them to get a profile.',
                )
              : _(
                  'The router issues the certificate of this client when the settings are applied. Apply them to get a profile.',
                ),
        ),
  ]);
}

// Why a client has no link: a credential the link needs, or the address it points
// at, is still missing.
function missingLinkReason(sectionId: string, client: ServerClient) {
  if (!hasRequiredCredentials(sectionId, client)) {
    return _('Fill in the credentials of this client to get a link.');
  }
  if (!getPublicHost(sectionId) || !getListenPort(sectionId)) {
    return _('Set the public host and the port to get a link.');
  }
  return _('A link cannot be built from these settings.');
}

function renderClientDetails(
  sectionId: string,
  client: ServerClient,
  context: ShareLinkContext,
) {
  const links = buildClientLinks(sectionId, client, context);
  const body = [];

  if (links.length) {
    links.forEach((entry) =>
      body.push(
        renderLinkRow(
          entry.link,
          linkCaption(sectionId, client, links.length > 1 ? entry.title : ''),
        ),
      ),
    );
  } else {
    body.push(
      E(
        'div',
        { class: 'fkp-details__empty' },
        missingLinkReason(sectionId, client),
      ),
    );
  }

  return renderClientRow(`${client?.name || ''}`.trim(), body);
}

// A Mixed listener without authentication has no accounts, and its link needs
// none: it is the address and nothing else.
function anonymousClient() {
  return {
    id: '',
    name: '',
    uuid: '',
    password: '',
    flow: '',
  };
}

function detailsEntries(sectionId: string, clients: ServerClient[]) {
  if (clients.length) {
    return clients;
  }
  return isAuthenticationEnabled(sectionId) ? [] : [anonymousClient()];
}

// The link a server hands out when it hands out exactly one.
function onlyLink(
  sectionId: string,
  clients: ServerClient[],
  context: ShareLinkContext,
) {
  const entries = detailsEntries(sectionId, clients);
  if (entries.length !== 1) {
    return null;
  }

  const links = buildClientLinks(sectionId, entries[0], context);
  return links.length === 1
    ? { caption: linkCaption(sectionId, entries[0], ''), link: links[0].link }
    : null;
}

// The dialog hands out what a client is given and nothing else: an account, its
// link, and the buttons to copy or scan it.
export function renderDetailsContent(
  sectionId: string,
  clients: ServerClient[],
  context: ShareLinkContext,
) {
  const children = [];
  const profiles = usesProfile(getProtocol(sectionId));

  const entries = detailsEntries(sectionId, clients);

  if (!entries.length) {
    children.push(
      E(
        'div',
        { class: 'fkp-details__empty' },
        _('Add a client to this server to get a link.'),
      ),
    );
  } else {
    // No heading over the accounts: each one is announced by its own name, and a
    // listener without accounts has nothing to announce.
    children.push(
      E(
        'div',
        { class: 'fkp-details__clients' },
        entries.map((client: ServerClient) =>
          profiles
            ? renderProfileDetails(sectionId, client, context.issued || {})
            : renderClientDetails(sectionId, client, context),
        ),
      ),
    );
  }

  return E(
    'div',
    { class: profiles ? 'fkp-details fkp-details--profiles' : 'fkp-details' },
    children,
  );
}

export function showServerDetailsModal(
  sectionId: string,
  clients: ServerClient[],
) {
  injectDetailsStyles();

  // A profile holds what the router issued, so the dialog waits for it rather
  // than open on a list that says every certificate is missing.
  if (usesProfile(getProtocol(sectionId))) {
    return loadIssuedMaterial().then((issued) => {
      ui.showModal(
        _('Server details: %s').format(getServerName(sectionId)),
        [
          renderDetailsContent(sectionId, clients, { issued }),
          renderCloseRow(),
        ],
        'fkp-details-modal--profiles',
      );
    });
  }

  // Everything but the certificate fingerprint is already known, so the dialog
  // opens filled in and the Hysteria2 links gain their pin a moment later.
  const initialContext = { tlsCertificateSha256: '' };

  // A server that hands out one link has nothing to choose from, so the code for
  // it is what opens.
  const only = onlyLink(sectionId, clients, initialContext);
  if (only) {
    const code = showQrModal(only.caption, only.link);
    return loadLinkContext(sectionId).then((context) => {
      const refreshed = onlyLink(sectionId, clients, context);
      if (code.parentNode && refreshed && refreshed.link !== only.link) {
        showQrModal(refreshed.caption, refreshed.link);
      }
    });
  }

  let content = renderDetailsContent(sectionId, clients, initialContext);

  ui.showModal(_('Server details: %s').format(getServerName(sectionId)), [
    content,
    renderCloseRow(),
  ]);

  return loadLinkContext(sectionId).then((context) => {
    if (!content.parentNode) {
      return;
    }
    const refreshed = renderDetailsContent(sectionId, clients, context);
    content.replaceWith(refreshed);
    content = refreshed;
  });
}
