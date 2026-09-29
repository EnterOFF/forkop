// What an AmneziaWG server has its clients send before every handshake: junk
// packets and signature packets. Neither has to match on the server, so they are
// the clients' to send and reach them in their profiles; the router issues the
// parameters both ends have to share when the settings are applied.

import {
  ONE_SIDED_AMNEZIA_DEFAULTS,
  amneziaParameter,
  validateAmneziaSet,
  validateAmneziaValue,
} from '../../../../helpers/wireguard';
import { FORKOP_UCI_PACKAGE } from '../../../../constants';
import { autofill } from '../controls';
import { liveOption, option } from '../formValues';

const CLIENT_KEYS = ['jc', 'jmin', 'jmax', 'i1', 'i2', 'i3', 'i4', 'i5'];

// A server that has never been AmneziaWG starts from the reference packets; one
// that has keeps what it holds, an emptied field included.
function hasAmneziaParameters(sectionId: string) {
  const section = uci.get(
    FORKOP_UCI_PACKAGE,
    sectionId,
  ) as UciSectionObject | null;
  return Object.keys(section || {}).some((key) => key.startsWith('amnezia_'));
}

export function addAmneziaServerOptions(section: CBISection) {
  CLIENT_KEYS.forEach((key: string) => {
    const description =
      key === 'jc'
        ? _(
            'Junk packets clients send before every handshake, Jmin to Jmax bytes each',
          )
        : key === 'i1'
          ? _('Packets clients send before every handshake, I1 first')
          : undefined;
    const o = section.option(
      form.Value,
      `amnezia_${key}`,
      amneziaParameter(key)!.conf,
      description,
    );
    o.modalonly = true;
    o.rmempty = true;
    o.depends('protocol', 'amneziawg');
    autofill(
      o,
      (sectionId: string) =>
        option(sectionId, `amnezia_${key}`) ||
        (hasAmneziaParameters(sectionId)
          ? ''
          : ONE_SIDED_AMNEZIA_DEFAULTS[key] || ''),
    );
    o.validate = (sectionId: string, value: string) => {
      const valid = validateAmneziaValue(key, value);
      if (valid !== true || (key !== 'jmin' && key !== 'jmax')) return valid;
      return validateAmneziaSet({
        jmin: key === 'jmin' ? value : liveOption(sectionId, 'amnezia_jmin'),
        jmax: key === 'jmax' ? value : liveOption(sectionId, 'amnezia_jmax'),
      });
    };
  });
}
