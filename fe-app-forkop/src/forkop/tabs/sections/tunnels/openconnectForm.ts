// The fields of the OpenConnect tunnel dialog in the order a sign-in goes: which
// server and protocol, how the router signs in, and how it knows the server.
// What only some servers need follows behind one switch.

import type { OpenConnectImportResult } from '../../../../helpers/parseOpenConnectConfig';
import { isEncryptedKey } from '../../../../helpers/material';
import { setModalOptionValue } from '../../../cbi/modal';
import { configureMaterialOption } from '../../../cbi/material';
import {
  openConnectInitialSettings,
  validateFormEntry,
  validateOpenConnectFingerprint,
  validateOpenConnectServer,
  validateTokenSecret,
} from './openconnect';

const FLAVORS = [
  ['anyconnect', 'Cisco AnyConnect, ocserv'],
  ['gp', 'Palo Alto GlobalProtect'],
  ['fortinet', 'Fortinet FortiGate'],
  ['pulse', 'Ivanti Connect Secure (Pulse)'],
  ['nc', 'Juniper Network Connect'],
  ['f5', 'F5 BIG-IP'],
];

function onKind(o: CBIOption, extra: Record<string, unknown> = {}) {
  o.depends({ tunnel_type: 'openconnect', ...extra });
  return o;
}

// An advanced field that only some protocols read.
function onFlavors(o: CBIOption, flavors: string[]) {
  flavors.forEach((flavor) =>
    onKind(o, { openconnect_advanced: '1', openconnect_flavor: flavor }),
  );
  return o;
}

function formValue(option: CBIOption, name: string) {
  const found = option.map.lookupOption(name, 'settings');
  if (!found) return '';
  return `${found[0].formvalue(found[1]) ?? found[0].cfgvalue(found[1]) ?? ''}`;
}

export function addOpenConnectOptions(section: CBISection) {
  const options: Record<string, CBIOption> = {};
  const add = (o: CBIOption) => {
    options[o.option] = o;
    return o;
  };
  const advanced = { openconnect_advanced: '1' };
  const stoken = { openconnect_token_mode: 'stoken' };
  const certificate = { openconnect_certificate_enabled: '1' };

  let o = add(
    onKind(section.option(form.ListValue, 'openconnect_flavor', _('Protocol'))),
  );
  FLAVORS.forEach(([value, label]) => o.value(value, label));
  o.default = 'anyconnect';
  o.rmempty = false;

  o = add(
    onKind(
      section.option(
        form.Value,
        'openconnect_server',
        _('Server'),
        _(
          'Host, with a port and a group path if the server has them: vpn.example.com:8443/staff',
        ),
      ),
    ),
  );
  o.rmempty = false;
  o.validate = (_sectionId: string, value: unknown) =>
    validateOpenConnectServer(value);

  o = add(
    onKind(section.option(form.Value, 'openconnect_username', _('Username'))),
  );
  o.rmempty = true;

  o = add(
    onKind(section.option(form.Value, 'openconnect_password', _('Password'))),
  );
  o.password = true;
  o.rmempty = true;

  o = add(
    onKind(
      section.option(
        form.Value,
        'openconnect_auth_group',
        _('Login group'),
        _('The group, realm or gateway the server offers at sign-in'),
      ),
    ),
  );
  o.rmempty = true;

  o = add(
    onKind(
      section.option(
        form.ListValue,
        'openconnect_token_mode',
        _('One-time code'),
        _('The router answers the request for a code itself'),
      ),
    ),
  );
  o.value('', _('None'));
  o.value('totp', 'TOTP');
  o.value('stoken', 'RSA SecurID');
  o.value('oidc', _('OIDC access token'));
  o.rmempty = true;

  o = add(
    section.option(
      form.Value,
      'openconnect_token_secret',
      _('Token secret'),
      _(
        'TOTP: the base32 secret or the otpauth:// link of the QR code. RSA SecurID: the token string. OIDC: the access token',
      ),
    ),
  );
  ['totp', 'stoken', 'oidc'].forEach((mode) =>
    onKind(o, { openconnect_token_mode: mode }),
  );
  o.password = true;
  o.rmempty = false;
  o.validate = function (_sectionId: string, value: unknown) {
    return validateTokenSecret(
      formValue(this, 'openconnect_token_mode'),
      value,
    );
  };

  o = add(
    onKind(
      section.option(form.Value, 'openconnect_token_pin', _('PIN')),
      stoken,
    ),
  );
  o.password = true;
  o.rmempty = true;

  o = add(
    onKind(
      section.option(
        form.Value,
        'openconnect_token_password',
        _('Token password'),
        _('Only for a token protected by a password'),
      ),
      stoken,
    ),
  );
  o.password = true;
  o.rmempty = true;

  o = add(
    onKind(
      section.option(
        form.Value,
        'openconnect_token_device_id',
        _('Device ID'),
        _('Only for a token bound to a device'),
      ),
      stoken,
    ),
  );
  o.rmempty = true;

  o = add(
    onKind(
      section.option(
        form.Flag,
        'openconnect_certificate_enabled',
        _('Client certificate'),
        _('Sign in with a certificate, alone or together with the login'),
      ),
    ),
  );
  o.default = '0';
  o.rmempty = false;

  o = add(
    onKind(
      section.option(form.TextValue, 'openconnect_cert', _('Certificate')),
      certificate,
    ),
  );
  configureMaterialOption(
    o,
    'certificate',
    () => _('Add the client certificate'),
    'openconnect_key',
  );

  o = add(
    onKind(
      section.option(form.TextValue, 'openconnect_key', _('Key')),
      certificate,
    ),
  );
  configureMaterialOption(
    o,
    'passphrase-key',
    () => _('Add the key of the client certificate'),
    'openconnect_cert',
  );
  o.onchange = () =>
    window.setTimeout(
      () => options.openconnect_key_password.triggerValidation('settings'),
      0,
    );

  o = add(
    onKind(
      section.option(
        form.Value,
        'openconnect_key_password',
        _('Key passphrase'),
        _('Only for a key protected by a passphrase'),
      ),
      certificate,
    ),
  );
  o.password = true;
  o.rmempty = true;
  o.validate = function (_sectionId: string, value: unknown) {
    return `${value ?? ''}` === '' &&
      isEncryptedKey(formValue(this, 'openconnect_key'))
      ? _('The client key is protected by a passphrase: enter it')
      : true;
  };

  o = add(
    onKind(
      section.option(
        form.TextValue,
        'openconnect_ca',
        _('CA certificate'),
        _(
          'For a server of your own: the authority that issued its certificate',
        ),
      ),
    ),
  );
  configureMaterialOption(o, 'ca', () => '');

  o = add(
    onKind(
      section.option(
        form.DynamicList,
        'openconnect_fingerprints',
        _('Server certificate fingerprints'),
        _(
          'pin-sha256:… as openconnect prints it. With one, the CA certificate is not needed',
        ),
      ),
    ),
  );
  o.rmempty = true;
  o.validate = (_sectionId: string, value: unknown) =>
    validateOpenConnectFingerprint(value);

  o = add(
    onKind(
      section.option(form.Flag, 'openconnect_advanced', _('Advanced settings')),
    ),
  );
  o.default = '0';
  o.rmempty = false;

  o = add(
    onKind(
      section.option(
        form.Flag,
        'openconnect_no_udp',
        _('TLS only'),
        _(
          'Carry the traffic over the TLS connection without the faster DTLS channel, for a network that drops or slows UDP',
        ),
      ),
      advanced,
    ),
  );
  o.default = '0';
  o.rmempty = true;

  o = add(
    onKind(
      section.option(
        form.Value,
        'openconnect_cookie',
        _('Session cookie'),
        _(
          'A session signed in elsewhere, such as after a browser sign-in. When the server refuses it, the login above is used',
        ),
      ),
      advanced,
    ),
  );
  o.password = true;
  o.rmempty = true;

  o = add(
    onKind(
      section.option(
        form.DynamicList,
        'openconnect_form_entries',
        _('Answers to the login form'),
        _(
          'For a field the server asks besides the login, as openconnect --form-entry takes it: FORM:NAME=VALUE',
        ),
      ),
      advanced,
    ),
  );
  o.rmempty = true;
  o.validate = (_sectionId: string, value: unknown) => validateFormEntry(value);

  o = add(
    onKind(
      section.option(
        form.Flag,
        'openconnect_browser',
        _('Browser sign-in'),
        _(
          'SSO and SAML through the sing-box dashboard, which the tunnel waits for at every connection',
        ),
      ),
      advanced,
    ),
  );
  o.default = '0';
  o.rmempty = true;

  o = add(
    onFlavors(
      section.option(
        form.ListValue,
        'openconnect_reported_os',
        _('Reported system'),
        _('For a server that admits only some systems'),
      ),
      ['anyconnect', 'gp', 'pulse'],
    ),
  );
  o.value('', _('Default (Linux)'));
  o.value('win', 'Windows');
  o.value('mac-intel', 'macOS');
  o.value('linux-64', _('Linux, 64-bit'));
  o.value('linux', _('Linux, 32-bit'));
  o.value('android', 'Android');
  o.value('apple-ios', 'iOS');
  o.rmempty = true;

  o = add(
    onKind(
      section.option(form.Value, 'openconnect_user_agent', _('User-Agent')),
      advanced,
    ),
  );
  o.rmempty = true;

  o = add(
    onFlavors(
      section.option(
        form.Value,
        'openconnect_version',
        _('Client version'),
        _('The AnyConnect version reported to the server'),
      ),
      ['anyconnect'],
    ),
  );
  o.placeholder = 'v9.21';
  o.rmempty = true;

  o = add(
    onKind(
      section.option(
        form.Value,
        'openconnect_local_hostname',
        _('Device name'),
        _('The name the router reports to the server'),
      ),
      advanced,
    ),
  );
  o.rmempty = true;

  o = add(
    onKind(
      section.option(
        form.Flag,
        'openconnect_insecure',
        _('Do not verify the server certificate'),
        _(
          'Anyone on the way can pose as the server. Add the CA certificate or a fingerprint instead',
        ),
      ),
      advanced,
    ),
  );
  o.default = '0';
  o.rmempty = true;

  o = add(
    onKind(
      section.option(
        form.Value,
        'openconnect_server_name',
        _('Server name (SNI)'),
      ),
      advanced,
    ),
  );
  o.datatype = 'hostname';
  o.rmempty = true;

  o = add(
    onKind(
      section.option(
        form.Flag,
        'openconnect_no_system_trust',
        _('Trust only the CA certificate above'),
        _('The authorities the router trusts are not used'),
      ),
      advanced,
    ),
  );
  o.default = '0';
  o.rmempty = true;

  o = add(
    onKind(
      section.option(
        form.Flag,
        'openconnect_insecure_crypto',
        _('Legacy encryption'),
        _('TLS 1.0 and weak ciphers, for an old server'),
      ),
      advanced,
    ),
  );
  o.default = '0';
  o.rmempty = true;

  o = add(
    onKind(
      section.option(
        form.Flag,
        'openconnect_pfs',
        _('Forward secrecy only'),
        _('Refuse a TLS 1.2 key exchange without forward secrecy'),
      ),
      advanced,
    ),
  );
  o.default = '0';
  o.rmempty = true;

  o = add(
    onFlavors(
      section.option(
        form.ListValue,
        'openconnect_compression',
        _('Compression'),
        _(
          'Compression weakens encryption where an attacker can mix data into the traffic',
        ),
      ),
      ['anyconnect'],
    ),
  );
  o.value('', _('Stateless (lz4, lzs)'));
  o.value('off', _('Off'));
  o.value('all', _('Also deflate'));
  o.rmempty = true;

  o = add(
    onKind(
      section.option(
        form.Flag,
        'openconnect_ipv6_disabled',
        _('No IPv6 in the tunnel'),
      ),
      advanced,
    ),
  );
  o.default = '0';
  o.rmempty = true;

  o = add(
    onKind(section.option(form.Value, 'openconnect_mtu', _('MTU')), advanced),
  );
  o.datatype = 'range(576,65535)';
  o.rmempty = true;

  o = add(
    onFlavors(
      section.option(
        form.Value,
        'openconnect_base_mtu',
        _('Path MTU'),
        _(
          'The MTU of the route to the server, which the tunnel is fitted into',
        ),
      ),
      ['anyconnect', 'gp', 'fortinet', 'f5'],
    ),
  );
  o.datatype = 'range(1280,65535)';
  o.placeholder = '1406';
  o.rmempty = true;

  o = add(
    onKind(
      section.option(
        form.Value,
        'openconnect_dpd',
        _('Dead peer detection, seconds'),
      ),
      advanced,
    ),
  );
  o.datatype = 'range(2,86400)';
  o.rmempty = true;

  return options;
}

export function applyImportedOpenConnect(
  map: CBIMap,
  options: Record<string, CBIOption>,
  result: Extract<OpenConnectImportResult, { valid: true }>,
) {
  const settings = openConnectInitialSettings(result.endpoint);
  // The switches go first: the fields behind them take their values only while
  // they show them.
  for (const name of [
    'openconnect_advanced',
    'openconnect_certificate_enabled',
    'openconnect_token_mode',
    'openconnect_flavor',
  ]) {
    setModalOptionValue(map, options[name], settings[name]);
  }
  map.checkDepends();
  Object.entries(options).forEach(([name, option]) => {
    if (name in settings) setModalOptionValue(map, option, settings[name]);
  });
  map.data.set(
    map.config,
    'settings',
    'openconnect_preserved',
    settings.openconnect_preserved,
  );
  map.checkDepends();
}
