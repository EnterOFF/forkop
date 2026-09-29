import { showToast } from '../../../helpers/showToast';
import {
  buildClientLinks,
  hasRequiredCredentials,
  loadLinkContext,
} from './links';
import { getListenPort, getPublicHost } from './network';
import { loadIssuedMaterial } from './issued';
import type { IssuedMaterial } from './issued';
import { buildOpenVPNProfile, downloadProfile } from './profile';
import {
  getProtocol,
  getServerName,
  isAuthenticationEnabled,
  usesProfile,
} from './protocols';
import { qrSvgDataUri } from './qr';
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
        // A table of the clients: the names in one column as wide as the longest
        // of them, their links beside, and a rule between two clients. A client is
        // no box of its own but its two cells, so every name lines up with the next
        // and the rule runs through both cells of a row.
        '.fkp-details__clients{display:grid;grid-template-columns:fit-content(14em) minmax(0,1fr);min-inline-size:0}',
        '.fkp-details__client{display:contents}',
        '.fkp-details__client > *{padding-block:10px;border-top:1px solid var(--border-color-low,rgba(128,128,128,.25))}',
        '.fkp-details__client:first-child > *{border-top:0;padding-top:0}',
        '.fkp-details__client:last-child > *{padding-bottom:0}',
        '.fkp-details__name{display:flex;align-items:center;min-inline-size:0;padding-inline-end:16px;font-weight:600}',
        '.fkp-details__name:empty{padding-inline-end:0}',
        '.fkp-details__name > span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.fkp-details__links{display:grid;gap:6px;align-content:center;min-inline-size:0}',
        // A phone has no room for two columns: the name goes over its links.
        '@media (max-width:560px){.fkp-details__clients{grid-template-columns:minmax(0,1fr)}.fkp-details__client > .fkp-details__links{border-top:0;padding-top:6px}.fkp-details__client > .fkp-details__name:not(:empty){padding-bottom:0}}',
        '.fkp-details__link{display:grid;grid-template-columns:minmax(0,1fr);grid-auto-flow:column;grid-auto-columns:auto;gap:8px;align-items:stretch;min-inline-size:0}',
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
        // width. The code keeps a white quiet zone in any theme: the two modules drawn
        // into it and a few pixels more.
        '#modal_overlay > .modal.fkp-qr-modal{width:fit-content}',
        '.fkp-qr{display:grid;justify-items:center;gap:12px;inline-size:min(16rem,calc(100vw - 64px));padding-top:8px}',
        '.fkp-qr__code{display:block;box-sizing:border-box;inline-size:100%;block-size:auto;aspect-ratio:1;padding:4px;background:#fff;border-radius:8px}',
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
// belongs to under it and the link it carries in a field that copies it.
export function showQrModal(caption: LinkCaption, link: string) {
  injectDetailsStyles();

  const content = E('div', { class: 'fkp-qr' }, [
    E('img', {
      class: 'fkp-qr__code',
      src: qrSvgDataUri(link),
      alt: _('QR code'),
    }),
    E('div', { class: 'fkp-qr__caption' }, [
      E('div', { class: 'fkp-qr__name' }, caption.name),
      ...(caption.details
        ? [E('div', { class: 'fkp-qr__details' }, caption.details)]
        : []),
    ]),
    renderLinkRow(link),
  ]);

  ui.showModal(_('QR code'), [content, renderCloseRow()], 'fkp-qr-modal');

  return content;
}

function renderQrButton(caption: LinkCaption, link: string) {
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
        showQrModal(caption, link);
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

// The profile of an OpenVPN client: its file name in the field, saved by one
// button and copied as text by the other. A profile does not fit a QR code a
// phone can read, and no OpenVPN client imports one from a code anyway.
function renderProfileRow(profile: string, name: string) {
  const input = E('input', {
    type: 'text',
    class: 'cbi-input-text fkp-details__value',
    readonly: 'readonly',
    spellcheck: 'false',
    value: name,
  });
  const label = _('Download the profile');
  return E('div', { class: 'fkp-details__link' }, [
    input,
    E(
      'button',
      {
        class: 'btn cbi-button cbi-button-neutral fkp-details__action',
        type: 'button',
        title: label,
        'aria-label': label,
        click: (ev: Event) => {
          ev.preventDefault();
          downloadProfile(profile, name);
        },
      },
      iconSvg('download'),
    ),
    renderCopyButton(profile, _('Copy the profile')),
  ]);
}

// One row of the client table: the name, and what the client is handed. A
// listener that asks for nothing has no account to name, and repeating the name
// of the server there would say nothing, so its cell stays empty.
function renderClientRow(name: string, body: Node[]) {
  return E('div', { class: 'fkp-details__client' }, [
    E(
      'div',
      { class: 'fkp-details__name' },
      name ? [E('span', { title: name }, name)] : [],
    ),
    E('div', { class: 'fkp-details__links' }, body),
  ]);
}

function renderProfileDetails(
  sectionId: string,
  client: ServerClient,
  material: IssuedMaterial,
) {
  const result = buildOpenVPNProfile(sectionId, client, material);
  return renderClientRow(client.name, [
    'profile' in result
      ? renderProfileRow(result.profile, result.fileName)
      : E(
          'div',
          { class: 'fkp-details__empty' },
          result.missing === 'address'
            ? _('Set the public host and the port to get a profile.')
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
            ? renderProfileDetails(sectionId, client, context.openvpn || {})
            : renderClientDetails(sectionId, client, context),
        ),
      ),
    );
  }

  return E('div', { class: 'fkp-details' }, children);
}

export function showServerDetailsModal(
  sectionId: string,
  clients: ServerClient[],
) {
  injectDetailsStyles();

  // A profile holds what the router issued, so the dialog waits for it rather
  // than open on a list that says every certificate is missing.
  if (usesProfile(getProtocol(sectionId))) {
    return loadIssuedMaterial().then((openvpn) => {
      ui.showModal(_('Server details: %s').format(getServerName(sectionId)), [
        renderDetailsContent(sectionId, clients, { openvpn }),
        renderCloseRow(),
      ]);
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
