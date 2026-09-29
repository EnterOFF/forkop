// A certificate or key field. What it holds is a PEM block nobody reads, so the
// field shows what the block is - whose certificate, until when - and keeps the
// text itself behind a button, next to one that loads it from a file.

import { E } from '../../../../helpers/element';
import { checkOpenVPNMaterial } from '../../../../helpers/openvpnMaterial';
import type { OpenVPNMaterialKind } from '../../../../helpers/openvpnMaterial';
import { certificateInfo } from '../../../../helpers/pem';

type FormValue = (name: string) => unknown;

const STYLE_ID = 'fkp-material-styles';

export function injectMaterialStyles() {
  if (document.getElementById(STYLE_ID)) return;
  document.head.appendChild(
    E(
      'style',
      { id: STYLE_ID },
      [
        '.fkp-material{display:grid;gap:0.5em;max-inline-size:100%}',
        '.fkp-material__row{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;column-gap:0.5em;align-items:stretch}',
        '.fkp-material__summary{box-sizing:border-box;inline-size:100% !important;max-inline-size:100% !important;min-inline-size:0;margin:0 !important;cursor:default;text-overflow:ellipsis}',
        '.fkp-material__row > button{display:inline-flex;align-items:center;justify-content:center;inline-size:2.5em !important;min-inline-size:0;padding:0 !important;margin:0 !important;float:none !important;line-height:1}',
        '.fkp-material textarea{font-family:monospace;font-size:12px}',
        '.fkp-import-files{display:flex;flex-wrap:wrap;align-items:center;gap:0.5em 1em}',
        '.fkp-import-files__names{color:var(--text-color-medium,#888);overflow-wrap:anywhere}',
        '.fkp-import-summary{white-space:pre-line;overflow-wrap:anywhere}',
        '.fkp-import-summary:empty{display:none}',
        '.fkp-import-summary--invalid{color:var(--error-color-medium,#d44)}',
      ].join('\n'),
    ),
  );
}

const ICONS: Record<string, string[]> = {
  file: [
    'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
    'M14 2v4a2 2 0 0 0 2 2h4',
    'M12 12v6',
    'm15 15-3-3-3 3',
  ],
  edit: [
    'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
  ],
  clear: ['M18 6 6 18', 'm6 6 12 12'],
};

function icon(name: string) {
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
  ICONS[name].forEach((d) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  });
  return svg;
}

function button(label: string, name: string, disabled: boolean) {
  return E(
    'button',
    {
      type: 'button',
      class: 'btn cbi-button cbi-button-neutral',
      title: label,
      'aria-label': label,
      disabled: disabled ? '' : null,
    },
    icon(name),
  );
}

// A certificate saved from Windows is often DER, the bytes without the armour.
export function readMaterialFile(bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes);
  if (text.includes('-----BEGIN') || !certificateInfo(bytes)) return text;
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  const body = btoa(binary).replace(/.{64}/g, '$&\n').trim();
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
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
  option.rows = 8;
  option.wrap = 'off';
  option.rmempty = true;
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
    const readonly = !!(this.readonly ?? this.map.readonly);
    const summary = E('input', {
      type: 'text',
      class: 'cbi-input-text fkp-material__summary',
      readonly: '',
      tabindex: '-1',
    }) as HTMLInputElement;
    const load = button(_('Load from a file'), 'file', readonly);
    const edit = button(_('Edit as text'), 'edit', readonly);
    const clear = button(_('Remove'), 'clear', readonly);
    // Never put on the page: a theme styles every file input it finds, and a
    // detached one opens its dialog all the same.
    const picker = E('input', { type: 'file' }) as HTMLInputElement;
    const widget = () => dom.findClassInstance(frame) as CBIWidget | null;

    const refresh = () => {
      const value = `${textarea?.value ?? ''}`.trim();
      const check = checkOpenVPNMaterial(kindOf(), value);
      const missing = value ? '' : required(formValueOf(this));
      summary.value = value
        ? check.valid
          ? check.summary
          : check.message
        : '';
      summary.placeholder =
        missing || _('Not set: load a file or paste the text');
      summary.classList.toggle('cbi-input-invalid', !!missing || !check.valid);
      summary.style.color =
        value && !check.valid
          ? 'var(--error-color-medium,#d44)'
          : check.expired
            ? 'var(--warn-color-medium,#c80)'
            : '';
      summary.title = summary.value || summary.placeholder;
      clear.style.visibility = value ? '' : 'hidden';
    };

    const assign = (value: string) => {
      const instance = widget();
      if (instance) {
        instance.setValue(value);
        instance.triggerValidation();
      } else if (textarea) {
        textarea.value = value;
      }
      textarea?.dispatchEvent(new Event('change', { bubbles: true }));
      refresh();
    };

    const instance = widget();
    if (instance) {
      const setValue = instance.setValue.bind(instance);
      instance.setValue = (value) => {
        setValue(value);
        window.setTimeout(refresh, 0);
      };
    }

    load.addEventListener('click', (ev) => {
      ev.preventDefault();
      picker.value = '';
      picker.click();
    });
    picker.addEventListener('change', () => {
      const file = picker.files?.[0];
      if (!file) return;
      file
        .arrayBuffer()
        .then((buffer) =>
          assign(readMaterialFile(new Uint8Array(buffer)).trim()),
        );
    });
    edit.addEventListener('click', (ev) => {
      ev.preventDefault();
      frame.hidden = !frame.hidden;
      if (!frame.hidden) textarea?.focus();
    });
    clear.addEventListener('click', (ev) => {
      ev.preventDefault();
      assign('');
    });
    textarea?.addEventListener('input', refresh);
    textarea?.addEventListener('change', refresh);

    const initial = `${textarea?.value ?? ''}`.trim();
    frame.hidden = !initial || checkOpenVPNMaterial(kindOf(), initial).valid;
    refresh();
    return E('div', { class: 'fkp-material' }, [
      E('div', { class: 'fkp-material__row' }, [summary, load, edit, clear]),
      frame,
    ]);
  };
}
