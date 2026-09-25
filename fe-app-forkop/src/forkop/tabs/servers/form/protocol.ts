import { clearClientList } from '../clients';
import { SHADOWSOCKS_METHODS } from '../constants';
import {
  addGenerateButton,
  addSshHostKeyButton,
  autofill,
  camouflageSite,
} from '../controls';
import { generatePassword, generatePresharedKey } from '../credentials';
import { option } from '../formValues';
import { getShadowsocksMethod, shadowsocksKeyBytes } from '../protocols';
import {
  validateFilePath,
  validateHost,
  validateOptionalDuration,
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
  o.rmempty = false;
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
    _('Require a login and password to connect to the server'),
  );
  // On by default: a listener that asks for nothing is an open proxy, and the port
  // is opened in the firewall by default too.
  o.default = '1';
  o.rmempty = false;
  o.modalonly = true;
  o.depends('protocol', 'mixed');
  // An inbound with no users accepts everybody, so the accounts of a Mixed server
  // are removed with the switch instead of lingering as credentials nobody sends.
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
    _('Required. Every client has to send the same value'),
  );
  o.modalonly = true;
  o.rmempty = false;
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

  for (const [field, label] of [
    ['min_packet_size', _('Minimum obfuscated packet size')],
    ['max_packet_size', _('Maximum obfuscated packet size')],
  ]) {
    o = section.option(form.Value, `hysteria2_gecko_${field}`, label);
    o.datatype = 'range(1,65535)';
    o.rmempty = true;
    o.modalonly = true;
    o.depends({ protocol: 'hysteria2', hysteria2_obfs_type: 'gecko' });
  }

  o = section.option(form.ListValue, 'hysteria2_bbr_profile', _('BBR profile'));
  o.value('', _('Default'));
  ['standard', 'conservative', 'aggressive'].forEach((value) =>
    o.value(value, value),
  );
  o.rmempty = true;
  o.modalonly = true;
  onHysteria2(o);

  o = section.option(form.Value, 'hysteria2_up_mbps', _('Upload, Mbps'));
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalPositiveInteger;
  onHysteria2(o);

  o = section.option(form.Value, 'hysteria2_down_mbps', _('Download, Mbps'));
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalPositiveInteger;
  onHysteria2(o);

  o = section.option(
    form.Flag,
    'hysteria2_ignore_client_bandwidth',
    _('Ignore client bandwidth'),
  );
  o.default = '0';
  o.rmempty = true;
  o.modalonly = true;
  onHysteria2(o);

  o = section.option(form.Value, 'hysteria2_masquerade', _('Masquerade'));
  o.placeholder = 'https://example.com';
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalMasquerade;
  onHysteria2(o);
}

export function addTuicOptions(section: CBISection) {
  const onTuic = (o: CBIOption) => o.depends('protocol', 'tuic');

  let o = section.option(
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
  onTuic(o);

  o = section.option(form.Value, 'tuic_heartbeat', _('Heartbeat'));
  o.placeholder = '10s';
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalDuration;
  onTuic(o);

  o = section.option(
    form.Flag,
    'tuic_zero_rtt_handshake',
    _('0-RTT handshake'),
  );
  o.default = '0';
  o.rmempty = true;
  o.modalonly = true;
  onTuic(o);
}

export function addProtocolOptions(section: CBISection) {
  let o = section.option(form.ListValue, 'naive_network', _('Network'));
  o.value('tcp', 'TCP (HTTP/2)');
  o.value('udp', 'UDP (HTTP/3)');
  o.value('tcp_udp', _('TCP and UDP'));
  o.default = 'tcp';
  o.rmempty = false;
  o.modalonly = true;
  o.depends('protocol', 'naive');

  o = section.option(
    form.Value,
    'ssh_host_key_path',
    _('SSH host key path'),
    _('Required. Create a new key with the button'),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.validate = function (sectionId: string, value: string) {
    const required = validateRequiredText(sectionId, value);
    return required === true ? validateFilePath(sectionId, value) : required;
  };
  o.depends('protocol', 'ssh');
  addSshHostKeyButton(o);

  o = section.option(form.ListValue, 'mieru_transport', _('Transport'));
  o.value('TCP', 'TCP');
  o.value('UDP', 'UDP');
  o.default = 'TCP';
  o.rmempty = false;
  o.modalonly = true;
  o.depends('protocol', 'mieru');
}

// One field. The proxy has no secret without a camouflage host - it is the second
// half of what the client sends - and everything else mtg takes has a working
// default: concurrency, the preferred address family, the fronting target and the
// three timeouts. A deployment that has to change one of them writes a JSON
// inbound; a router owner never does.
export function addMtprotoOptions(section: CBISection) {
  const o = section.option(
    form.Value,
    'mtproto_faketls',
    _('FakeTLS host'),
    _('The domain a client sends in the TLS handshake'),
  );
  o.placeholder = 'google.com';
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validateHost;
  autofill(
    o,
    (sectionId: string) =>
      option(sectionId, 'mtproto_faketls') || camouflageSite(sectionId),
  );
  o.depends('protocol', 'mtproto');
  addGenerateButton(
    o,
    (sectionId: string) => camouflageSite(sectionId, true),
    _('Pick a domain'),
  );
}
