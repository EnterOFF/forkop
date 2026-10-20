import {
  coreHas,
  missingCoreFeatureNote,
  validateCoreFeature,
} from '../../../services/coreFeatures.service';
import { clearClientList } from '../clients';
import { SHADOWSOCKS_METHODS } from '../constants';
import { addGenerateButton, autofill } from '../controls';
import { generatePassword, generatePresharedKey } from '../credentials';
import { option } from '../formValues';
import { getShadowsocksMethod, shadowsocksKeyBytes } from '../protocols';
import {
  validateOptionalMasquerade,
  validateOptionalPositiveInteger,
  validateRequired,
  validateRequiredText,
  validateShadowsocksPassword,
} from '../validators';

export function addShadowsocksOptions(section: CBISection) {
  let o = section.option(form.ListValue, 'shadowsocks_method', _('Method'));
  SHADOWSOCKS_METHODS.forEach((method) => o.value(method.id, method.id));
  o.default = SHADOWSOCKS_METHODS[0].id;
  o.rmempty = false;
  o.modalonly = true;
  o.validate = validateRequired;
  o.depends('protocol', 'shadowsocks');

  o = section.option(form.Value, 'shadowsocks_psk', _('Server key'));
  o.modalonly = true;
  o.password = true;
  o.validate = validateShadowsocksPassword;
  SHADOWSOCKS_METHODS.filter((method) => method.keyBytes > 0).forEach(
    (method) =>
      o.depends({ protocol: 'shadowsocks', shadowsocks_method: method.id }),
  );
  autofill(
    o,
    (sectionId: string) =>
      option(sectionId, 'shadowsocks_psk') ||
      generatePresharedKey(
        shadowsocksKeyBytes(getShadowsocksMethod(sectionId)) || 32,
      ),
  );
  addGenerateButton(o, (sectionId: string) =>
    generatePresharedKey(
      shadowsocksKeyBytes(getShadowsocksMethod(sectionId)) || 32,
    ),
  );
}

export function addMixedOptions(section: CBISection) {
  const o = section.option(
    form.Flag,
    'mixed_auth_enabled',
    _('Authentication'),
  );
  // On by default: a listener asking for nothing is an open proxy on a port the firewall opens.
  o.default = '1';
  o.rmempty = false;
  o.modalonly = true;
  o.depends('protocol', 'mixed');
  // An inbound without users accepts everybody, so a Mixed server's accounts go with the switch.
  o.onchange = function (_ev, sectionId: string, value: unknown) {
    if (String(value) !== '1') {
      clearClientList(this.map, sectionId);
    }
  };
}

export function addHysteria2Options(section: CBISection) {
  const onHysteria2 = (o: CBIOption) => o.depends('protocol', 'hysteria2');

  let o = section.option(
    form.ListValue,
    'hysteria2_obfs_type',
    _('Obfuscation'),
  );
  o.value('', _('None'));
  o.value('salamander', 'salamander');
  o.value('gecko', 'gecko');
  o.default = '';
  o.rmempty = true;
  o.modalonly = true;
  onHysteria2(o);

  o = section.option(
    form.Value,
    'hysteria2_obfs_password',
    _('Obfuscation password'),
  );
  o.modalonly = true;
  o.password = true;
  o.validate = validateRequiredText;
  autofill(
    o,
    (sectionId: string) =>
      option(sectionId, 'hysteria2_obfs_password') || generatePassword(),
  );
  o.depends({ protocol: 'hysteria2', hysteria2_obfs_type: 'salamander' });
  o.depends({ protocol: 'hysteria2', hysteria2_obfs_type: 'gecko' });
  addGenerateButton(o, () => generatePassword());

  o = section.option(form.ListValue, 'hysteria2_bbr_profile', _('BBR profile'));
  o.value('', _('Default'));
  ['standard', 'conservative', 'aggressive'].forEach((value) =>
    o.value(value, value),
  );
  o.rmempty = true;
  o.modalonly = true;
  onHysteria2(o);

  o = section.option(
    form.Value,
    'hysteria2_up_mbps',
    _('Max speed to a client, Mbps'),
  );
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalPositiveInteger;
  onHysteria2(o);

  o = section.option(
    form.Value,
    'hysteria2_down_mbps',
    _('Max speed from a client, Mbps'),
  );
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalPositiveInteger;
  onHysteria2(o);

  o = section.option(form.Value, 'hysteria2_masquerade', _('Masquerade'));
  o.placeholder = 'https://example.com';
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalMasquerade;
  onHysteria2(o);
}

export function addTuicOptions(section: CBISection) {
  const o = section.option(
    form.ListValue,
    'tuic_congestion_control',
    _('Congestion control'),
  );
  ['cubic', 'new_reno', 'bbr'].forEach((value: string) =>
    o.value(value, value),
  );
  o.default = 'cubic';
  o.rmempty = false;
  o.modalonly = true;
  o.depends('protocol', 'tuic');
}

export function addProtocolOptions(section: CBISection) {
  let o = section.option(form.ListValue, 'naive_network', _('Network'));
  // HTTP/3 needs QUIC, which a core may be built without; a server already on it keeps it, marked.
  o.load = function (sectionId: string) {
    const current = option(sectionId, 'naive_network') || 'tcp';
    this.keylist = [];
    this.vallist = [];
    this.value('tcp', 'TCP (HTTP/2)');
    [
      ['udp', 'UDP (HTTP/3)'],
      ['tcp_udp', _('TCP and UDP')],
    ].forEach(([value, label]) => {
      if (coreHas('quic')) {
        this.value(value, label);
      } else if (value === current) {
        this.value(value, `${label} (${missingCoreFeatureNote('quic')})`);
      }
    });
    return current;
  };
  o.validate = (_sectionId: string, value: string) =>
    validateCoreFeature(value === 'udp' || value === 'tcp_udp' ? 'quic' : '');
  o.default = 'tcp';
  o.rmempty = false;
  o.modalonly = true;
  o.depends('protocol', 'naive');

  o = section.option(form.ListValue, 'mieru_transport', _('Transport'));
  o.value('TCP', 'TCP');
  o.value('UDP', 'UDP');
  o.default = 'TCP';
  o.rmempty = false;
  o.modalonly = true;
  o.depends('protocol', 'mieru');
}
