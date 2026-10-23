import { E } from '../../helpers/element';
import { checkMaterial, splitCertificateAndKey } from '../../helpers/material';
import type { MaterialKind } from '../../helpers/material';
import { isCertificate } from '../../helpers/pem';
import { configureTextareaOption } from './annotatedTextarea';
import { message } from '../../validators/messages';
import { MONOSPACE_FONT } from '../../constants';

type FormValue = (name: string) => unknown;

const STYLE_ID = 'fkp-material-styles';

export function injectMaterialStyles() {
  if (document.getElementById(STYLE_ID)) return;
  document.head.appendChild(
    E(
      'style',
      { id: STYLE_ID },
      [
        '.fkp-material{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:4px;align-items:start;max-inline-size:100%}',
        `.fkp-material textarea{box-sizing:border-box;inline-size:100% !important;resize:vertical !important;font-family:${MONOSPACE_FONT};font-size:12px}`,
        '.fkp-material > button{display:block;text-align:center;inline-size:2.5em !important;min-inline-size:0;padding:0 !important;margin:0 !important;float:none !important}',
        '.fkp-material > button > svg{vertical-align:middle}',
      ].join('\n'),
    ),
  );
}

const FILE_ICON = [
  'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
  'M14 2v4a2 2 0 0 0 2 2h4',
  'M12 12v6',
  'm15 15-3-3-3 3',
];

export function fileIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  Object.entries({
    viewBox: '0 0 24 24',
    width: '16',
    height: '16',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }).forEach(([key, value]) => svg.setAttribute(key, value));
  FILE_ICON.forEach((d) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  });
  return svg;
}

// A certificate saved from Windows is often DER, the bytes without the armour.
export function readMaterialFile(bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes);
  if (text.includes('-----BEGIN') || !isCertificate(bytes)) return text;
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  const body = btoa(binary).replace(/.{64}/g, '$&\n').trim();
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
}

// A detached file input still opens, and no theme restyles it.
export function pickFiles(multiple: boolean, onPick: (files: File[]) => void) {
  const picker = E('input', { type: 'file' }) as HTMLInputElement;
  picker.multiple = multiple;
  picker.addEventListener('change', () =>
    onPick(Array.from(picker.files || [])),
  );
  picker.click();
}

function formValueOf(option: CBIOption, sectionId: string): FormValue {
  return (name: string) => {
    const found = option.map.lookupOption(name, sectionId);
    if (!found) return null;
    const value = found[0].formvalue(found[1]);
    return value ?? found[0].cfgvalue(found[1]);
  };
}

function setFieldValue(widget: CBIWidget | null, value: string) {
  widget?.setValue(value);
  widget?.triggerValidation();
  widget?.node
    ?.querySelector('textarea')
    ?.dispatchEvent(new Event('change', { bubbles: true }));
}

// A file holding a certificate and its key fills both fields.
export function loadedMaterial(
  text: string,
  kind: MaterialKind,
  paired: boolean,
): { own: string; pair: string | null } {
  const both = paired ? splitCertificateAndKey(text) : null;
  if (!both) return { own: text, pair: null };
  return kind === 'key' || kind === 'passphrase-key'
    ? { own: both.key, pair: both.certificate }
    : { own: both.certificate, pair: both.key };
}

export function configureMaterialOption(
  option: CBIOption,
  kind: MaterialKind | ((value: FormValue) => MaterialKind),
  required: (value: FormValue) => boolean,
  pair?: string,
) {
  option.rows = 4;
  option.wrap = 'off';
  option.rmempty = true;
  configureTextareaOption(option);
  option.validate = function (sectionId: string, value: unknown) {
    const values = formValueOf(this, sectionId);
    const content = `${value ?? ''}`.trim();
    if (!content) return required(values) ? message.required() : true;
    return checkMaterial(
      typeof kind === 'function' ? kind(values) : kind,
      content,
    );
  };

  const renderWidget = option.renderWidget;
  option.renderWidget = function (
    sectionId: string,
    optionIndex: string,
    cfgvalue: unknown,
  ) {
    injectMaterialStyles();
    const frame = renderWidget.call(
      this,
      sectionId,
      optionIndex,
      cfgvalue,
    ) as HTMLElement;
    const label = _('Load from a file');
    const readonly = !!(this.readonly ?? this.map.readonly);
    const pairWidget = () => {
      const found = pair ? this.map.lookupOption(pair, sectionId) : null;
      return found ? (found[0].getUIElement(found[1]) as CBIWidget) : null;
    };
    const load = E(
      'button',
      {
        type: 'button',
        class: 'btn cbi-button cbi-button-neutral',
        title: label,
        'aria-label': label,
        disabled: readonly ? '' : null,
      },
      fileIcon(),
    );
    const fill = (text: string) => {
      const other = pairWidget();
      const loaded = loadedMaterial(
        text,
        typeof kind === 'function' ? kind(formValueOf(this, sectionId)) : kind,
        !!other,
      );
      setFieldValue(
        dom.findClassInstance(frame) as CBIWidget | null,
        loaded.own,
      );
      if (loaded.pair != null) setFieldValue(other, loaded.pair);
    };
    load.addEventListener('click', (ev) => {
      ev.preventDefault();
      pickFiles(false, ([file]) => {
        if (!file) return;
        file
          .arrayBuffer()
          .then((buffer) =>
            fill(readMaterialFile(new Uint8Array(buffer)).trim()),
          );
      });
    });
    // A paste holding both halves is split like a loaded file.
    frame.querySelector('textarea')?.addEventListener('paste', (ev) => {
      const text = ev.clipboardData?.getData('text') ?? '';
      if (!pair || !splitCertificateAndKey(text)) return;
      ev.preventDefault();
      fill(text.trim());
    });
    return E('div', { class: 'fkp-material' }, [frame, load]);
  };
}
