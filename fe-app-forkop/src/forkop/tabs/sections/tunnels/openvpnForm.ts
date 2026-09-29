// The fields of the OpenVPN tunnel dialog, in the order a profile is read: where
// the server is, how the tunnel proves who it is, and how the control channel
// is wrapped. The tuning of the connection follows behind one switch, and the
// static key mode only when asked for.

import {
  OPENVPN_DEFAULT_DATA_CIPHERS,
  OPENVPN_DEFAULT_PORT,
} from '../../../../helpers/parseOpenVPNConfig';
import type { OpenVPNImportResult } from '../../../../helpers/parseOpenVPNConfig';
import { normalizeOptionValues } from '../../../cbi/listValues';
import { setModalOptionValue } from '../../../cbi/modal';
import { configureOpenVPNMaterial } from './material';
import {
  COMPRESSION_LABELS,
  DATA_CIPHERS,
  DIGESTS,
  STATIC_CIPHERS,
  openVPNInitialSettings,
  trimmed,
  validateAddress,
  validateServerEntry,
} from './openvpn';

function secondsOption(
  section: CBISection,
  name: string,
  title: string,
  description: string,
  placeholder: string,
) {
  const o = section.option(form.Value, name, title, description);
  o.datatype = 'uinteger';
  o.placeholder = placeholder;
  o.rmempty = true;
  return o;
}

function onKind(o: CBIOption, extra: Record<string, unknown> = {}) {
  o.depends({ tunnel_type: 'openvpn-client', ...extra });
  return o;
}

export function addOpenVPNOptions(section: CBISection) {
  const options: Record<string, CBIOption> = {};
  const add = (name: string, o: CBIOption) => {
    options[name] = o;
    return o;
  };
  const tls = { openvpn_mode: 'tls' };
  const staticKey = { openvpn_mode: 'static_key' };
  const advanced = { openvpn_advanced: '1' };

  let o = add(
    'openvpn_servers',
    onKind(
      section.option(
        form.DynamicList,
        'openvpn_servers',
        _('Servers'),
        _(
          'Host and port of the OpenVPN server. With several, the next one is tried when a server does not answer. Put tcp:// or udp:// before a server that uses the other protocol',
        ),
      ),
    ),
  );
  o.placeholder = `vpn.example.com:${OPENVPN_DEFAULT_PORT}`;
  o.rmempty = false;
  o.validate = function (_sectionId: string, value: unknown) {
    if (!trimmed(value)) {
      const current =
        typeof this.formvalue === 'function' ? this.formvalue('settings') : [];
      return normalizeOptionValues(current).length
        ? true
        : _('Add at least one OpenVPN server');
    }
    return validateServerEntry(value);
  };

  o = add(
    'openvpn_network',
    onKind(section.option(form.ListValue, 'openvpn_network', _('Transport'))),
  );
  o.value('udp', 'UDP');
  o.value('tcp', 'TCP');
  o.default = 'udp';
  o.rmempty = false;

  o = add(
    'openvpn_mode',
    onKind(
      section.option(
        form.ListValue,
        'openvpn_mode',
        _('Mode'),
        _(
          'A static key is the outdated mode without certificates. Choose it only for a server that uses one',
        ),
      ),
    ),
  );
  o.value('tls', _('TLS (certificates)'));
  o.value('static_key', _('Static key'));
  o.default = 'tls';
  o.rmempty = false;

  o = add(
    'openvpn_login',
    onKind(
      section.option(
        form.Flag,
        'openvpn_login',
        _('Username and password'),
        _('The server asks for a username and a password (auth-user-pass)'),
      ),
      tls,
    ),
  );
  o.default = '0';
  o.rmempty = false;

  o = add(
    'openvpn_username',
    onKind(section.option(form.Value, 'openvpn_username', _('Username')), {
      ...tls,
      openvpn_login: '1',
    }),
  );
  o.rmempty = false;
  o.validate = (_sectionId: string, value: unknown) =>
    trimmed(value) ? true : _('Enter the username');

  o = add(
    'openvpn_password',
    onKind(section.option(form.Value, 'openvpn_password', _('Password')), {
      ...tls,
      openvpn_login: '1',
    }),
  );
  o.password = true;
  o.rmempty = true;

  o = add(
    'openvpn_ca',
    onKind(
      section.option(
        form.TextValue,
        'openvpn_ca',
        _('CA certificate'),
        _('The certificate the server certificate is checked against (ca)'),
      ),
      tls,
    ),
  );
  configureOpenVPNMaterial(o, 'ca', (value) =>
    value('openvpn_advanced') === '1' &&
    normalizeOptionValues(value('openvpn_peer_fingerprint')).length
      ? ''
      : _('Add the CA certificate the server certificate is checked against'),
  );

  o = add(
    'openvpn_cert',
    onKind(
      section.option(
        form.TextValue,
        'openvpn_cert',
        _('Client certificate'),
        _(
          'The certificate this tunnel presents (cert). A server that asks only for a login needs none',
        ),
      ),
      tls,
    ),
  );
  configureOpenVPNMaterial(o, 'certificate', (value) =>
    trimmed(value('openvpn_key'))
      ? _('Add the certificate of the client key')
      : '',
  );

  o = add(
    'openvpn_key',
    onKind(
      section.option(
        form.TextValue,
        'openvpn_key',
        _('Client key'),
        _('The private key of the client certificate (key)'),
      ),
      tls,
    ),
  );
  configureOpenVPNMaterial(o, 'key', (value) =>
    trimmed(value('openvpn_cert'))
      ? _('Add the key of the client certificate')
      : '',
  );

  o = add(
    'openvpn_control_wrap',
    onKind(
      section.option(
        form.ListValue,
        'openvpn_control_wrap',
        _('Control channel protection'),
        _(
          'The extra key the server wraps its handshake in: tls-auth, tls-crypt or tls-crypt-v2',
        ),
      ),
      tls,
    ),
  );
  o.value('', _('None'));
  o.value('tls_auth', 'tls-auth');
  o.value('tls_crypt', 'tls-crypt');
  o.value('tls_crypt_v2', 'tls-crypt-v2');
  o.rmempty = true;

  o = add(
    'openvpn_control_wrap_key',
    section.option(
      form.TextValue,
      'openvpn_control_wrap_key',
      _('Control channel key'),
    ),
  );
  for (const type of ['tls_auth', 'tls_crypt', 'tls_crypt_v2']) {
    onKind(o, { ...tls, openvpn_control_wrap: type });
  }
  configureOpenVPNMaterial(
    o,
    (value) =>
      value('openvpn_control_wrap') === 'tls_crypt_v2' ? 'crypt-v2' : 'static',
    () => _('Add the key of the control channel protection'),
  );
  options.openvpn_control_wrap.onchange = () =>
    window.setTimeout(
      () => options.openvpn_control_wrap_key.triggerValidation('settings'),
      0,
    );

  o = add(
    'openvpn_key_direction',
    section.option(
      form.ListValue,
      'openvpn_key_direction',
      _('Key direction'),
      _('key-direction of the profile. Clients use 1'),
    ),
  );
  o.value('1', '1');
  o.value('0', '0');
  o.value('', _('Both directions'));
  o.default = '1';
  o.rmempty = true;
  onKind(o, { ...tls, openvpn_control_wrap: 'tls_auth' });
  onKind(o, staticKey);

  o = add(
    'openvpn_static_key',
    onKind(
      section.option(
        form.TextValue,
        'openvpn_static_key',
        _('Static key'),
        _('The shared key of the tunnel (secret)'),
      ),
      staticKey,
    ),
  );
  configureOpenVPNMaterial(o, 'static', () => _('Add the static key'));

  o = add(
    'openvpn_static_cipher',
    onKind(
      section.option(form.ListValue, 'openvpn_static_cipher', _('Cipher')),
      staticKey,
    ),
  );
  o.value('', _('Default (BF-CBC)'));
  STATIC_CIPHERS.forEach((cipher) => o.value(cipher, cipher));
  o.rmempty = true;

  o = add(
    'openvpn_address',
    onKind(
      section.option(
        form.DynamicList,
        'openvpn_address',
        _('Tunnel addresses'),
        _('The addresses of this end of the tunnel in CIDR format (ifconfig)'),
      ),
      staticKey,
    ),
  );
  o.placeholder = '10.8.0.2/32';
  o.rmempty = false;
  o.validate = (_sectionId: string, value: unknown) =>
    trimmed(value) ? validateAddress(value) : true;

  o = add(
    'openvpn_peer_address',
    onKind(
      section.option(
        form.Value,
        'openvpn_peer_address',
        _('Peer address'),
        _('The IPv4 address of the other end of the tunnel'),
      ),
      staticKey,
    ),
  );
  o.datatype = 'ip4addr("nomask")';
  o.rmempty = true;

  o = add(
    'openvpn_peer_address_ipv6',
    onKind(
      section.option(
        form.Value,
        'openvpn_peer_address_ipv6',
        _('Peer IPv6 address'),
        _('The IPv6 address of the other end of the tunnel'),
      ),
      staticKey,
    ),
  );
  o.datatype = 'ip6addr("nomask")';
  o.rmempty = true;

  o = add(
    'openvpn_advanced',
    onKind(
      section.option(
        form.Flag,
        'openvpn_advanced',
        _('Advanced settings'),
        _(
          'Server certificate checks, ciphers, compression, MTU and timers. Off, they keep their defaults',
        ),
      ),
    ),
  );
  o.default = '0';
  o.rmempty = false;

  o = add(
    'openvpn_remote_random',
    onKind(
      section.option(
        form.Flag,
        'openvpn_remote_random',
        _('Random server order'),
        _('Try the servers in random order (remote-random)'),
      ),
      advanced,
    ),
  );
  o.default = '0';
  o.rmempty = true;

  o = add(
    'openvpn_server_name',
    onKind(
      section.option(
        form.Value,
        'openvpn_server_name',
        _('Server certificate name'),
        _(
          'The name the server certificate must carry (verify-x509-name). Empty: any certificate the CA issued',
        ),
      ),
      { ...tls, ...advanced },
    ),
  );
  o.rmempty = true;

  o = add(
    'openvpn_server_name_type',
    onKind(
      section.option(
        form.ListValue,
        'openvpn_server_name_type',
        _('Name match'),
      ),
      {
        ...tls,
        ...advanced,
      },
    ),
  );
  o.value('name', _('Common name (name)'));
  o.value('name-prefix', _('Start of the common name (name-prefix)'));
  o.value('subject', _('Whole subject (subject)'));
  o.default = 'name';
  o.rmempty = true;

  o = add(
    'openvpn_verify_purpose',
    onKind(
      section.option(
        form.ListValue,
        'openvpn_verify_purpose',
        _('Server certificate purpose'),
        _(
          'What proves the certificate was issued to a server and not to another client',
        ),
      ),
      { ...tls, ...advanced },
    ),
  );
  o.value('server', 'remote-cert-tls server');
  o.value('ns', 'ns-cert-type server');
  o.value('none', _('Do not check'));
  o.default = 'server';
  o.rmempty = true;

  o = add(
    'openvpn_peer_fingerprint',
    onKind(
      section.option(
        form.DynamicList,
        'openvpn_peer_fingerprint',
        _('Server certificate fingerprints'),
        _(
          'SHA-256 fingerprints the server certificate must match (peer-fingerprint). With them the CA certificate is not needed',
        ),
      ),
      { ...tls, ...advanced },
    ),
  );
  o.rmempty = true;
  o.validate = (_sectionId: string, value: unknown) =>
    !trimmed(value) ||
    /^[0-9a-f]{64}$/.test(trimmed(value).replace(/:/g, '').toLowerCase())
      ? true
      : _('Enter a SHA-256 fingerprint of 64 hex digits');

  o = add(
    'openvpn_certificate_profile',
    onKind(
      section.option(
        form.ListValue,
        'openvpn_certificate_profile',
        _('Certificate profile'),
        _(
          'Which signature algorithms and key sizes are accepted (tls-cert-profile)',
        ),
      ),
      { ...tls, ...advanced },
    ),
  );
  o.value('', _('Default (legacy)'));
  o.value('preferred', 'preferred');
  o.value('insecure', _('insecure: also MD5 and short keys'));
  o.value('suiteb', 'suiteb');
  o.rmempty = true;

  o = add(
    'openvpn_tls_version_min',
    onKind(
      section.option(
        form.ListValue,
        'openvpn_tls_version_min',
        _('Minimum TLS version'),
      ),
      {
        ...tls,
        ...advanced,
      },
    ),
  );
  o.value('', _('Default (1.2)'));
  ['1.0', '1.1', '1.2', '1.3'].forEach((version) => o.value(version, version));
  o.rmempty = true;

  o = add(
    'openvpn_tls_cipher',
    onKind(
      section.option(
        form.Value,
        'openvpn_tls_cipher',
        _('TLS ciphers'),
        _(
          'Cipher suites of the control channel up to TLS 1.2, separated by colons (tls-cipher)',
        ),
      ),
      { ...tls, ...advanced },
    ),
  );
  o.placeholder = 'TLS-ECDHE-ECDSA-WITH-AES-128-GCM-SHA256';
  o.rmempty = true;

  o = add(
    'openvpn_data_ciphers',
    onKind(
      section.option(
        form.MultiValue,
        'openvpn_data_ciphers',
        _('Data ciphers'),
        _('The ciphers offered to the server (data-ciphers). Empty: %s').format(
          OPENVPN_DEFAULT_DATA_CIPHERS.join(', '),
        ),
      ),
      { ...tls, ...advanced },
    ),
  );
  DATA_CIPHERS.forEach((cipher) => o.value(cipher, cipher));
  o.create = true;
  o.rmempty = true;

  o = add(
    'openvpn_data_ciphers_fallback',
    onKind(
      section.option(
        form.ListValue,
        'openvpn_data_ciphers_fallback',
        _('Fallback cipher'),
        _(
          'The cipher of a server older than 2.4, which cannot agree on one (cipher, data-ciphers-fallback)',
        ),
      ),
      { ...tls, ...advanced },
    ),
  );
  o.value('', _('None'));
  DATA_CIPHERS.forEach((cipher) => o.value(cipher, cipher));
  o.rmempty = true;

  o = add(
    'openvpn_auth',
    onKind(
      section.option(
        form.ListValue,
        'openvpn_auth',
        _('Packet authentication'),
        _('The digest of CBC ciphers and of tls-auth (auth)'),
      ),
      advanced,
    ),
  );
  o.value('', _('Default (SHA1)'));
  DIGESTS.forEach((digest) => o.value(digest, digest));
  o.rmempty = true;

  o = add(
    'openvpn_compression',
    onKind(
      section.option(
        form.ListValue,
        'openvpn_compression',
        _('Compression'),
        _('Only for a server that requires it: compression weakens encryption'),
      ),
      advanced,
    ),
  );
  o.value('', _('Off'));
  Object.entries(COMPRESSION_LABELS).forEach(([value, label]) =>
    o.value(value, label),
  );
  o.rmempty = true;

  o = add(
    'openvpn_mtu',
    onKind(
      section.option(form.Value, 'openvpn_mtu', _('MTU'), _('tun-mtu')),
      advanced,
    ),
  );
  o.datatype = 'range(576,65535)';
  o.placeholder = '1500';
  o.rmempty = true;

  o = add(
    'openvpn_fragment',
    onKind(
      section.option(
        form.Value,
        'openvpn_fragment',
        _('Fragment size'),
        _(
          'Largest UDP packet before OpenVPN splits it (fragment). Only if the server uses it too',
        ),
      ),
      { ...advanced, openvpn_network: 'udp' },
    ),
  );
  o.datatype = 'range(68,65535)';
  o.rmempty = true;

  o = add(
    'openvpn_mss_fix',
    onKind(
      section.option(
        form.Value,
        'openvpn_mss_fix',
        _('MSS clamping'),
        _(
          'Largest packet size TCP connections are fitted to (mssfix). 0 switches it off',
        ),
      ),
      advanced,
    ),
  );
  o.datatype = 'range(0,65535)';
  o.placeholder = '1492';
  o.rmempty = true;

  add(
    'openvpn_ping_interval',
    onKind(
      secondsOption(
        section,
        'openvpn_ping_interval',
        _('Ping interval, seconds'),
        _('A server usually sets it itself (ping)'),
        '',
      ),
      advanced,
    ),
  );
  add(
    'openvpn_ping_restart',
    onKind(
      secondsOption(
        section,
        'openvpn_ping_restart',
        _('Reconnect after silence, seconds'),
        _('A server usually sets it itself (ping-restart). 0 switches it off'),
        '120',
      ),
      advanced,
    ),
  );
  add(
    'openvpn_renegotiate',
    onKind(
      secondsOption(
        section,
        'openvpn_renegotiate',
        _('Key renegotiation, seconds'),
        _('reneg-sec. 0 switches it off'),
        '3600',
      ),
      { ...tls, ...advanced },
    ),
  );

  return options;
}

export function applyImportedOpenVPN(
  map: CBIMap,
  options: Record<string, CBIOption>,
  result: Extract<OpenVPNImportResult, { valid: true }>,
) {
  const settings = openVPNInitialSettings(result.endpoint);
  settings.openvpn_login = result.login ? '1' : '0';
  // The advanced switch goes first: the fields behind it take their values
  // only while it shows them.
  setModalOptionValue(map, options.openvpn_advanced, settings.openvpn_advanced);
  setModalOptionValue(map, options.openvpn_mode, settings.openvpn_mode);
  setModalOptionValue(map, options.openvpn_login, settings.openvpn_login);
  map.checkDepends();
  Object.entries(options).forEach(([name, option]) => {
    if (name in settings) setModalOptionValue(map, option, settings[name]);
  });
  map.data.set(
    map.config,
    'settings',
    'openvpn_preserved',
    settings.openvpn_preserved,
  );
  map.checkDepends();
}
