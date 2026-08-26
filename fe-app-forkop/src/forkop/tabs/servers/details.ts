import { showToast } from '../../../helpers/showToast';
import {
  buildClientLinks,
  hasRequiredCredentials,
  loadLinkContext,
} from './links';
import { getListenPort, getPublicHost } from './network';
import { getServerName, isAuthenticationEnabled } from './protocols';
import { qrSvgDataUri } from './qr';

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
        // The one deviation, and it is deliberate: their first column has a 120px
        // floor because their labels are long enough to fill it, and mine are short
        // enough that the floor pushed every value a third of the way across the
        // dialog. max-content puts the value 16px after the longest label.
        '.fkp-details__clients{display:grid;gap:14px;min-inline-size:0}',
        '.fkp-details__client{display:grid;gap:6px;min-width:0}',
        '.fkp-details__name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.fkp-details__link{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:stretch;min-inline-size:0}',
        '.fkp-details__value{inline-size:100% !important;max-inline-size:100% !important;min-inline-size:0;box-sizing:border-box;margin:0 !important;float:none !important;font-family:monospace;font-size:12px}',
        '.fkp-details__action{display:inline-flex;align-items:center;justify-content:center;inline-size:2.5em !important;min-inline-size:0;padding:0 !important;margin:0 !important;float:none !important;line-height:1}',
        '.fkp-details__empty{color:var(--text-color-medium,#666)}',
        // The theme aligns a modal button row with .modal > .button-row and pushes a
        // lone button left with .modal > .button-row > button:first-of-type. A bare
        // class loses to both, so the override extends the same selectors instead.
        '.modal > .button-row.fkp-details-actions{justify-content:flex-end;gap:0.5em}',
        '.modal > .button-row.fkp-details-actions > button:first-of-type{margin-right:0}',
        '.fkp-qr{display:grid;justify-items:center;gap:14px;min-inline-size:0}',
        '.fkp-qr__code{display:block;inline-size:14rem;block-size:14rem;max-inline-size:100%;image-rendering:pixelated;background:#fff;padding:10px;box-sizing:content-box;border:1px solid var(--border-color-low,rgba(128,128,128,0.2))}',
        '.fkp-qr__link{inline-size:100%;box-sizing:border-box;padding:8px 10px;background:rgba(128,128,128,0.06);border:1px solid var(--border-color-low,rgba(128,128,128,0.2));font-family:monospace;font-size:11px;line-height:1.5;word-break:break-all;color:var(--text-color-medium,#666)}',
      ].join('\n'),
    ),
  );
}

// A copy control stays a copy control: the toast says what happened, and swapping
// the icon for a tick is not something the rest of the app does.
function renderCopyButton(value: string) {
  const label = _('Copy');
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

// The code is shown when it is asked for, at a size a phone can read, with the link
// it carries written out underneath so it is clear what is being scanned.
function showQrModal(title: string, link: string) {
  injectDetailsStyles();

  ui.showModal(`${_('QR code')}: ${title}`, [
    E('div', { class: 'fkp-qr' }, [
      E('img', {
        class: 'fkp-qr__code',
        src: qrSvgDataUri(link),
        alt: _('QR code'),
      }),
      E('div', { class: 'fkp-qr__link' }, link),
    ]),
    renderCloseRow(),
  ]);
}

function renderQrButton(title: string, link: string) {
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
        showQrModal(title, link);
      },
    },
    iconSvg('qr'),
  );
}

// What a code or a link belongs to. An account is named the way the stacked settings
// dialogs name a child item; a listener that has no account is named by its scheme,
// because that is the only thing telling its two links apart.
export function linkTitle(
  sectionId: string,
  client: ServerClient,
  scheme: string,
) {
  const server = getServerName(sectionId);
  const name = `${client?.name || ''}`.trim();

  if (!name) {
    return scheme ? `${server} (${scheme})` : server;
  }

  const title = `${server} \u00bb ${_('Client')}: ${name}`;
  return scheme ? `${title} (${scheme})` : title;
}

function renderLinkRow(value: string, qrTitle: string) {
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
    renderQrButton(qrTitle, value),
    renderCopyButton(value),
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
  const name = `${client?.name || ''}`.trim();
  const body = [];

  // A listener that asks for nothing has no account to name, and repeating the name
  // of the server there would say nothing.
  if (name) {
    body.push(E('div', { class: 'fkp-details__name' }, name));
  }

  if (links.length) {
    links.forEach((entry) =>
      body.push(
        renderLinkRow(
          entry.link,
          linkTitle(sectionId, client, links.length > 1 ? entry.title : ''),
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

  return E('div', { class: 'fkp-details__client' }, body);
}

// A Mixed listener without authentication has no accounts, and its link needs
// none: it is the address and nothing else.
function anonymousClient() {
  return {
    id: '',
    name: '',
    uuid: '',
    password: '',
    secret: '',
    flow: '',
    authorized_keys: [],
  };
}

// The dialog hands out what a client is given and nothing else: an account, its
// link, and the buttons to copy or scan it. Everything else it used to state was
// already in the link.
export function renderDetailsContent(
  sectionId: string,
  clients: ServerClient[],
  context: ShareLinkContext,
) {
  const children = [];

  const entries = clients.length
    ? clients
    : isAuthenticationEnabled(sectionId)
      ? []
      : [anonymousClient()];

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
          renderClientDetails(sectionId, client, context),
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

  // Everything but the certificate fingerprint is already known, so the dialog
  // opens filled in and the Hysteria2 links gain their pin a moment later.
  let content = renderDetailsContent(sectionId, clients, {
    tlsCertificateSha256: '',
  });

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
