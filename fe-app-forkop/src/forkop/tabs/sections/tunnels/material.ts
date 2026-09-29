// A certificate or key field: the PEM text in a textarea that grows only
// downwards, and beside it the button that loads it from a file - the form most
// of these come in.

import { E } from '../../../../helpers/element';
import { checkOpenVPNMaterial } from '../../../../helpers/openvpnMaterial';
import type { OpenVPNMaterialKind } from '../../../../helpers/openvpnMaterial';
import { isCertificate } from '../../../../helpers/pem';
import { configureTextareaOption } from '../../../cbi/annotatedTextarea';

type FormValue = (name: string) => unknown;

const STYLE_ID = 'fkp-material-styles';

export function injectMaterialStyles() {
  if (document.getElementById(STYLE_ID)) return;
  document.head.appendChild(
    E(
      'style',
      { id: STYLE_ID },
      [
        '.fkp-material{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:0.5em;align-items:start;max-inline-size:100%}',
        '.fkp-material textarea{box-sizing:border-box;inline-size:100% !important;resize:vertical !important;font-family:monospace;font-size:12px}',
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

// Opens the file dialog of a file input that is never put on the page: a theme
// styles every file input it finds, and a detached one opens all the same.
export function pickFiles(multiple: boolean, onPick: (files: File[]) => void) {
  const picker = E('input', { type: 'file' }) as HTMLInputElement;
  picker.multiple = multiple;
  picker.addEventListener('change', () =>
    onPick(Array.from(picker.files || [])),
  );
  picker.click();
}

// The value of another field of the same dialog as it stands.
function formValueOf(option: CBIOption): FormValue {
  return (name: string) => {
    const found = option.map.lookupOption(name, 'settings');
    if (!found) return null;
    const value = found[0].formvalue(found[1]);
    return value ?? found[0].cfgvalue(found[1]);
  };
}

export function configureOpenVPNMaterial(
  option: CBIOption,
  kind: OpenVPNMaterialKind | ((value: FormValue) => OpenVPNMaterialKind),
  required: (value: FormValue) => string,
) {
  const kindOf = () =>
    typeof kind === 'function' ? kind(formValueOf(option)) : kind;
  option.rows = 4;
  option.wrap = 'off';
  option.rmempty = true;
  // No spell checking, and the four rows are also the least it shrinks to.
  configureTextareaOption(option);
  option.validate = function (_sectionId: string, value: unknown) {
    const content = `${value ?? ''}`.trim();
    if (!content) return required(formValueOf(this)) || true;
    const check = checkOpenVPNMaterial(kindOf(), content);
    return check.valid ? true : check.message;
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
    const textarea = frame.querySelector('textarea');
    const label = _('Load from a file');
    const readonly = !!(this.readonly ?? this.map.readonly);
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
    load.addEventListener('click', (ev) => {
      ev.preventDefault();
      pickFiles(false, ([file]) => {
        if (!file) return;
        file.arrayBuffer().then((buffer) => {
          const widget = dom.findClassInstance(frame) as CBIWidget | null;
          widget?.setValue(readMaterialFile(new Uint8Array(buffer)).trim());
          widget?.triggerValidation();
          textarea?.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
    });
    return E('div', { class: 'fkp-material' }, [frame, load]);
  };
}
