// Every AmneziaWG parameter of a server, named as its configuration names it,
// empty until the generate button above them fills them in. The server runs
// with them and hands them all to its clients in their profiles; the signature
// packets are only the clients' to send.

import {
  AMNEZIA_PARAMETERS,
  generateAmneziaParameters,
  validateAmneziaSet,
  validateAmneziaValue,
} from '../../../../helpers/wireguard';
import { applyFieldValue } from '../controls';
import { liveOption, widgetNode } from '../formValues';

// The parameters checked together, each with the others of its group.
const GROUPS = [
  ['jmin', 'jmax'],
  ['s1', 's2', 's3', 's4', 'header_protection_key'],
  ['h1', 'h2', 'h3', 'h4'],
];

function revalidate(sectionId: string, keys: string[]) {
  window.setTimeout(() =>
    keys.forEach((key) => {
      const node = widgetNode(sectionId, `amnezia_${key}`);
      const element = node ? dom.findClassInstance(node) : null;
      (element as CBIWidget | null)?.triggerValidation?.();
    }),
  );
}

export function addAmneziaServerOptions(section: CBISection) {
  const button = section.option(
    form.Button,
    '_generate_amnezia',
    _('Obfuscation parameters'),
  );
  button.inputtitle = _('Generate parameters');
  button.inputstyle = 'apply';
  button.modalonly = true;
  button.depends('protocol', 'amneziawg');
  button.onclick = (_ev: Event, sectionId: unknown) =>
    Object.entries(generateAmneziaParameters()).forEach(([key, value]) =>
      applyFieldValue(`${sectionId}`, `amnezia_${key}`, value),
    );

  AMNEZIA_PARAMETERS.forEach(({ key, conf, kind }) => {
    const o = section.option(
      kind === 'flag' ? form.Flag : form.Value,
      `amnezia_${key}`,
      conf,
    );
    o.modalonly = true;
    o.rmempty = true;
    o.depends('protocol', 'amneziawg');
    if (kind === 'flag') return;

    o.password = kind === 'key';
    const group = GROUPS.find((keys) => keys.includes(key));
    o.validate = (sectionId: string, value: string) => {
      const valid = validateAmneziaValue(key, value);
      if (valid !== true || !group) return valid;
      return validateAmneziaSet(
        Object.fromEntries(
          group.map((other) => [
            other,
            other === key ? value : liveOption(sectionId, `amnezia_${other}`),
          ]),
        ),
      );
    };
    if (group) {
      o.onchange = (_ev: Event, sectionId: string) =>
        revalidate(
          sectionId,
          group.filter((other) => other !== key),
        );
    }
  });
}
