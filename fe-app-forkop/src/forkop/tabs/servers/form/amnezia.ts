// Every AmneziaWG parameter of a server, named as its configuration names it.
// The server runs with them and hands them all to its clients in their profiles;
// the signature packets are only the clients' to send.

import {
  AMNEZIA_PARAMETERS,
  ONE_SIDED_AMNEZIA_DEFAULTS,
  amneziaDescription,
  validateAmneziaSet,
  validateAmneziaValue,
} from '../../../../helpers/wireguard';
import { addGenerateButton, autofill } from '../controls';
import { generatePresharedKey } from '../credentials';
import { liveOption, option, widgetNode } from '../formValues';

// What the Amnezia client installs a fresh AmneziaWG 3.1 server with: paddings
// as short as the header protection nonce allows, the WireGuard message types as
// headers, which the protection key hides, random trailers, no cookie replies,
// the junk, signature packet and timings a tunnel takes as well, and no content
// padding, which its installer leaves out. The protection key is drawn anew.
const SERVER_DEFAULTS: Record<string, string> = {
  ...ONE_SIDED_AMNEZIA_DEFAULTS,
  s1: '12',
  s2: '12',
  s3: '12',
  s4: '12',
  h1: '1',
  h2: '2',
  h3: '3',
  h4: '4',
  content_padding_addition: '',
  random_trailers: '1',
  disable_cookies: '1',
};

// The parameters checked together, each with the others of its group.
const GROUPS = [
  ['jmin', 'jmax'],
  ['s1', 's2', 's3', 's4', 'header_protection_key'],
  ['h1', 'h2', 'h3', 'h4'],
];

function protectionKey() {
  return generatePresharedKey(32);
}

// A server becomes AmneziaWG with the reference parameters; one that already is
// keeps what it holds, an emptied field included.
function initialValue(sectionId: string, key: string) {
  if (option(sectionId, 'protocol') === 'amneziawg') {
    return option(sectionId, `amnezia_${key}`);
  }
  return key === 'header_protection_key'
    ? protectionKey()
    : SERVER_DEFAULTS[key] || '';
}

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
  AMNEZIA_PARAMETERS.forEach(({ key, conf, kind }) => {
    const o = section.option(
      kind === 'flag' ? form.Flag : form.Value,
      `amnezia_${key}`,
      conf,
      amneziaDescription(key),
    );
    o.modalonly = true;
    o.rmempty = true;
    o.depends('protocol', 'amneziawg');
    autofill(o, (sectionId: string) => initialValue(sectionId, key));
    if (kind === 'flag') return;

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
    if (kind === 'key') {
      o.password = true;
      addGenerateButton(o, () => protectionKey());
    }
  });
}
