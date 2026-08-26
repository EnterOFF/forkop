import { FORKOP_UCI_PACKAGE } from '../../../constants';
import { showToast } from '../../../helpers/showToast';
import { CAMOUFLAGE_SITES, STYLE_ID } from './constants';
import { randomItem } from './credentials';
import { iconSvg } from './details';
import { liveOption, option, widgetNode } from './formValues';
import {
  getEffectiveSecurity,
  getProtocol,
  securitiesFor,
  securityLabel,
} from './protocols';

export function injectServerStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  document.head.appendChild(
    E(
      'style',
      { id: STYLE_ID },
      [
        // The generate button sits in the same grid the child item list uses, so it
        // lines up with the input instead of floating next to it.
        '.fkp-generate-row{--fkp-generate-gap:0.5em;--fkp-generate-size:2.5em;column-gap:var(--fkp-generate-gap);display:inline-grid;grid-template-columns:minmax(0,1fr) auto;max-inline-size:100%}',
        '.fkp-generate-row > :first-child{grid-column:1;min-inline-size:0}',
        '.fkp-generate-row > .fkp-generate{align-items:center;align-self:stretch;box-sizing:border-box;display:inline-flex;grid-column:2;inline-size:var(--fkp-generate-size) !important;justify-content:center;line-height:1;margin:0 !important;min-block-size:0;min-inline-size:0;padding:0 !important;float:none !important;user-select:none}',
        '.fkp-generate-row--rows > .fkp-generate{align-self:start;block-size:var(--fkp-generate-row-size,auto)}',
        '.fkp-generate-row > .fkp-generate > svg{display:block}',
        `#cbi-${FORKOP_UCI_PACKAGE}-server > h3:nth-child(1){display:none}`,
        `#cbi-${FORKOP_UCI_PACKAGE}-server > .cbi-section-remove{margin-bottom:-32px}`,
        `#cbi-${FORKOP_UCI_PACKAGE}-server .cbi-section-actions > div{display:inline-flex;align-items:center;gap:4px}`,
        `#cbi-${FORKOP_UCI_PACKAGE}-server .cbi-section-actions{text-align:right}`,
        '.fkp-server-info{box-sizing:border-box;vertical-align:middle}',
        '.fkp-server-info__glyph{display:inline-block;line-height:1;transform:scale(1.55);transform-origin:center}',
      ].join('\n'),
    ),
  );
}

function widgetElement(node: HTMLElement): CBIWidget | null {
  const instance = dom.findClassInstance(node) as CBIWidget | null;
  return instance && typeof instance.setValue === 'function' ? instance : null;
}

function controlOf(node: HTMLElement | null): HTMLElement | null {
  if (!node) {
    return null;
  }
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(node.tagName)) {
    return node;
  }
  return typeof node.querySelector === 'function'
    ? (node.querySelector(
        "input:not([type='hidden']), select, textarea",
      ) as HTMLElement | null)
    : null;
}

// Fills a field with a freshly generated value. Nothing is generated until the
// button is pressed, so an untouched field stays empty and the validator asks for it.
// The control every generate button is: the same square icon button beside the
// field, disabled with the rest of a read-only dialog.
function renderGenerateButton(label: string, readonly: unknown) {
  return E(
    'button',
    {
      class: 'btn cbi-button cbi-button-neutral fkp-generate',
      type: 'button',
      title: label,
      'aria-label': label,
      disabled: readonly ? '' : null,
    },
    iconSvg('generate'),
  );
}

export function addGenerateButton(
  optionRef: CBIOption,
  generate: (sectionId: string, current?: unknown) => string | null | undefined,
  title?: string,
) {
  const renderWidget = optionRef.renderWidget;

  optionRef.renderWidget = function (
    sectionId: string,
    optionIndex: string,
    cfgvalue: unknown,
  ) {
    const node = renderWidget.call(
      this,
      sectionId,
      optionIndex,
      cfgvalue,
    ) as HTMLElement;
    const label = title || _('Generate');
    const readonly = this.readonly != null ? this.readonly : this.map.readonly;
    const button = renderGenerateButton(label, readonly);

    button.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      if (readonly) {
        return;
      }

      const element = widgetElement(node);
      const next = generate(sectionId, element ? element.getValue() : null);

      if (next == null) {
        return;
      }
      if (element) {
        element.setValue(next);
        // A field keeps the invalid mark until it is checked again, so a generated
        // value is validated the same way a typed one is.
        if (typeof element.triggerValidation === 'function') {
          element.triggerValidation();
        }
      }
      controlOf(node)?.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // A list grows row by row, so its button keeps the height of one row the way the
    // child item list does. A single control simply stretches to its own height.
    const rows = !!node.querySelector?.('.add-item');
    const row = E(
      'div',
      {
        class: rows
          ? 'fkp-generate-row fkp-generate-row--rows'
          : 'fkp-generate-row',
      },
      [node, button],
    );

    if (rows) {
      const measure = () => {
        const height = controlOf(node)?.offsetHeight || 0;
        if (height > 0) {
          button.style.setProperty('--fkp-generate-row-size', `${height}px`);
        }
      };

      if (typeof ResizeObserver === 'function') {
        new ResizeObserver(measure).observe(node);
      } else {
        window.setTimeout(measure, 0);
      }
    }

    return row;
  };
}

function getSelectWidget(
  sectionId: string,
  name: string,
): HTMLSelectElement | null {
  const node = widgetNode(sectionId, name);

  if (!node) {
    return null;
  }
  if (node.tagName === 'SELECT') {
    return node as HTMLSelectElement;
  }

  return typeof node.querySelector === 'function'
    ? node.querySelector('select')
    : null;
}

// The security modes depend on the protocol and LuCI cannot express that with
// depends(), so the choices are rebuilt whenever the protocol changes.
// The protocol change handler runs before the new value reaches the form, so the
// protocol is handed over instead of being read back.
export function syncSecurityChoices(
  sectionId: string,
  protocol?: unknown,
  reset?: boolean,
) {
  const allowed = securitiesFor(protocol || getProtocol(sectionId));
  const select = getSelectWidget(sectionId, 'security');
  const stored = select ? select.value : option(sectionId, 'security');
  // A protocol change starts from that protocol's own best mode. Carrying the
  // previous value over would leave VLESS on None just because None is allowed.
  const next = !reset && allowed.includes(stored) ? stored : allowed[0];

  if (!select) {
    if (stored !== next) {
      uci.set(FORKOP_UCI_PACKAGE, sectionId, 'security', next);
    }
    return;
  }

  select.replaceChildren(
    ...allowed.map((security: string) =>
      E(
        'option',
        { value: security, selected: security === next ? '' : undefined },
        securityLabel(security),
      ),
    ),
  );
  select.value = next;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

// A camouflage host is picked once per dialog, so the SNI a link carries and the
// FakeTLS host of the same server keep the domain the dialog offered rather than
// each rolling their own.
const camouflageChoice = new Map<string, string>();

export function camouflageSite(sectionId: string, reroll?: boolean) {
  if (reroll || !camouflageChoice.has(sectionId)) {
    camouflageChoice.set(sectionId, randomItem(CAMOUFLAGE_SITES));
  }
  return camouflageChoice.get(sectionId);
}

// Puts a value into another field of the open dialog. The widget wins over the
// stored value while the dialog is open, so the value goes there and is checked
// right away; without a mounted widget the write goes to the configuration.
function applyFieldValue(sectionId: string, name: string, value: UciValue) {
  const node = widgetNode(sectionId, name);
  const element = node ? widgetElement(node) : null;

  if (!element) {
    uci.set(FORKOP_UCI_PACKAGE, sectionId, name, value);
    return;
  }

  element.setValue(value);
  if (typeof element.triggerValidation === 'function') {
    element.triggerValidation();
  }
  controlOf(node)?.dispatchEvent(new Event('change', { bubbles: true }));
}

// One key pair per dialog: the two fields are loaded separately but have to hold
// halves of the same pair.
const pendingKeypairs = new Map();

export function realityKeypair(sectionId: string) {
  if (getEffectiveSecurity(sectionId) !== 'reality') {
    return Promise.resolve(null);
  }

  if (!pendingKeypairs.has(sectionId)) {
    pendingKeypairs.set(
      sectionId,
      generateRealityKeypair(sectionId).finally(() =>
        window.setTimeout(() => pendingKeypairs.delete(sectionId), 0),
      ),
    );
  }
  return pendingKeypairs.get(sectionId);
}

function generateRealityKeypair(_sectionId: string) {
  return fs
    .exec('/usr/bin/forkop', ['generate_reality_keypair'])
    .then((response) => {
      if ((response.code ?? 0) !== 0 || !response.stdout) {
        throw new Error(response.stderr || response.stdout || '');
      }

      const data = JSON.parse(response.stdout);
      if (!data.success || !data.private_key || !data.public_key) {
        throw new Error(data.message || '');
      }

      return data;
    })
    .catch((error) => {
      console.warn(error?.message || 'Failed to generate a Reality key pair');
      showToast(_('Could not generate a Reality key pair'), 'error');
      return null;
    });
}

// The subject a client checks, taken from the dialog as it stands: the SNI when
// there is one, otherwise the address the links carry, otherwise the name of the
// server. The section id is never it.
function certificateSubject(sectionId: string) {
  return (
    liveOption(sectionId, 'tls_server_name') ||
    liveOption(sectionId, 'public_host') ||
    liveOption(sectionId, 'label') ||
    sectionId
  );
}

// Writing files happens when a button is pressed, not while the service starts, and
// the path that was written becomes the value of the field instead of a convention
// only Forkop knows. The certificate and the SSH host key are both issued this way.
function addIssueButton(
  optionRef: CBIOption,
  label: string,
  request: (sectionId: string, node: HTMLElement) => Promise<unknown>,
  offered?: (protocol: string) => boolean,
) {
  const renderWidget = optionRef.renderWidget;

  optionRef.renderWidget = function (
    sectionId: string,
    optionIndex: string,
    cfgvalue: unknown,
  ) {
    const node = renderWidget.call(
      this,
      sectionId,
      optionIndex,
      cfgvalue,
    ) as HTMLElement;
    const readonly = this.readonly != null ? this.readonly : this.map.readonly;
    const button = renderGenerateButton(label, readonly);

    button.addEventListener('click', (ev) => {
      ev.preventDefault();

      if (readonly) {
        return;
      }

      button.disabled = true;
      request(sectionId, node)
        .catch((error: Error) => {
          console.warn(error?.message || 'Failed to issue the file');
        })
        .finally(() => {
          button.disabled = readonly ? true : false;
        });
    });

    const row = E('div', { class: 'fkp-generate-row' }, [node, button]);
    if (typeof offered === 'function') {
      showIssueButton(row, offered(getProtocol(sectionId)));
    }

    return row;
  };
}

// The button is built once, with whatever protocol the dialog held at that moment,
// and a later protocol change only shows and hides the fields - LuCI does not build
// them again. So the button is shown and hidden the same way instead of being decided
// at render time: a server that started as Mixed and became NaiveProxy kept a button
// an existing NaiveProxy server never had.
//
// Inline, because the rule that lays the button out inside the row is a class
// selector and would win over [hidden]; the column goes with it, or its gap stays
// behind an input that now fills the row.
function showIssueButton(row: HTMLElement, shown: boolean) {
  const button = row.querySelector<HTMLElement>('.fkp-generate');
  if (!button) {
    return;
  }

  button.style.display = shown ? '' : 'none';
  row.style.gridTemplateColumns = shown ? '' : 'minmax(0,1fr)';
}

// The certificate Forkop issues is self-signed, and a NaiveProxy client verifies it
// the way a browser does, so pressing the button there would only build a listener no
// client reaches. The two path fields stay, for a certificate of your own.
function offersCertificateButton(protocol: unknown) {
  return protocol !== 'naive';
}

export function syncCertificateButton(sectionId: string, protocol: unknown) {
  const node = widgetNode(sectionId, 'tls_certificate_path');
  if (node && node.parentElement) {
    showIssueButton(node.parentElement, offersCertificateButton(protocol));
  }
}

function issueRequest(
  verb: string,
  args: string[],
  onResult: (data: ForkopIssueResult) => void,
) {
  return fs.exec('/usr/bin/forkop', [verb, ...args]).then((response) => {
    if ((response.code ?? 0) !== 0 || !response.stdout) {
      throw new Error(response.stderr || response.stdout || '');
    }
    const data = JSON.parse(response.stdout);
    if (!data.success) {
      throw new Error(data.message || '');
    }
    onResult(data);
  });
}

export function addCertificateButton(optionRef: CBIOption) {
  addIssueButton(
    optionRef,
    _('Generate a certificate'),
    (sectionId: string) =>
      issueRequest(
        'generate_server_certificate',
        // The section id, not the display name: a name has to be sanitised to be a
        // file name, and two servers named in Cyrillic would sanitise to the same one.
        [certificateSubject(sectionId), sectionId],
        (data) => {
          if (!data.certificate_path || !data.key_path) {
            throw new Error('');
          }
          applyFieldValue(
            sectionId,
            'tls_certificate_path',
            data.certificate_path,
          );
          applyFieldValue(sectionId, 'tls_key_path', data.key_path);
          showToast(_('Certificate generated'), 'success');
        },
      ).catch((error) => {
        showToast(_('Could not generate a certificate'), 'error');
        throw error;
      }),
    offersCertificateButton,
  );
}

// One key. An SSH server can hold several so that an old client finds an algorithm
// it knows, but AddHostKey replaces a key of the same type instead of adding it, and
// Forkop only issues ed25519 - so a second generated key would silently take the
// place of the first. Every client that reaches a proxy inbound has known ed25519
// for a decade; a second algorithm belongs in a JSON inbound.
export function addSshHostKeyButton(optionRef: CBIOption) {
  addIssueButton(optionRef, _('Generate a host key'), (sectionId: string) =>
    issueRequest('generate_ssh_host_key', [sectionId], (data) => {
      if (!data.key_path) {
        throw new Error('');
      }
      applyFieldValue(sectionId, 'ssh_host_key_path', data.key_path);
      showToast(_('Host key generated'), 'success');
    }).catch((error) => {
      showToast(_('Could not generate a host key'), 'error');
      throw error;
    }),
  );
}

// Both halves of the pair are written at once, so the button sits on the private
// key and fills the public one in beside it.
export function addRealityKeypairButton(optionRef: CBIOption) {
  addIssueButton(optionRef, _('Generate a key pair'), (sectionId: string) =>
    generateRealityKeypair(sectionId).then((pair) => {
      if (!pair) {
        return;
      }
      [
        ['reality_private_key', pair.private_key],
        ['reality_public_key', pair.public_key],
      ].forEach(([name, value]) => applyFieldValue(sectionId, name, value));
    }),
  );
}

// A value the dialog fills in by itself. LuCI keeps whatever load() returned as
// the stored value of an option, so an untouched autofilled field compares equal
// on save and would never reach the configuration: a fresh server ended up with
// no port, no public host and no Reality identity, and the service then refused
// the whole configuration. forcewrite makes the save write it.
export function autofill(option: CBIOption, loader: CBIOption['load']) {
  option.forcewrite = true;
  option.load = loader;
}
