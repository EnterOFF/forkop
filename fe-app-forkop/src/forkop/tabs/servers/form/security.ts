import {
  ALPN_PROTOCOLS,
  CLIENT_FINGERPRINTS,
  DEFAULT_CLIENT_FINGERPRINT,
  TRANSPORTS,
} from '../constants';
import {
  addCertificateButton,
  addGenerateButton,
  addRealityKeypairButton,
  autofill,
  camouflageSite,
  realityKeypair,
  syncSecurityChoices,
} from '../controls';
import { randomHex } from '../credentials';
import { isEmptyValue, option, optionList } from '../formValues';
import {
  getEffectiveSecurity,
  protocolSpec,
  protocolsWhere,
  protocolsWith,
} from '../protocols';
import {
  validateGrpcServiceName,
  validateHost,
  validateOptionalHost,
  validateOptionalHostList,
  validateRealityKey,
  validateSecurity,
  validateShortId,
  validateTlsCertificatePath,
  validateTlsKeyPath,
  validateTransportPath,
} from '../validators';

export function addSecurityOptions(section: CBISection) {
  const streamProtocols = protocolsWith('transport');
  const tlsOnlyProtocols = protocolsWhere(
    (entry) =>
      (entry.securities || []).length === 1 && entry.securities?.[0] === 'tls',
  );
  const onTls = (o: CBIOption) => {
    streamProtocols.forEach((protocol: string) =>
      o.depends({ protocol, security: 'tls' }),
    );
    tlsOnlyProtocols.forEach((protocol: string) =>
      o.depends('protocol', protocol),
    );
  };
  const onReality = (o: CBIOption) =>
    o.depends({ protocol: 'vless', security: 'reality' });

  let o = section.option(form.ListValue, 'security', _('Security'));
  o.value('reality', 'Reality');
  o.value('tls', 'TLS');
  o.value('none', _('None'));
  o.rmempty = false;
  o.modalonly = true;
  [...streamProtocols, ...tlsOnlyProtocols].forEach((protocol: string) =>
    o.depends('protocol', protocol),
  );
  o.validate = validateSecurity;
  {
    const renderWidget = o.renderWidget;
    o.renderWidget = function (
      sectionId: string,
      optionIndex,
      cfgvalue: unknown,
    ) {
      const node = renderWidget.call(this, sectionId, optionIndex, cfgvalue);
      window.setTimeout(() => syncSecurityChoices(sectionId), 0);
      return node;
    };
  }

  o = section.option(
    form.Value,
    'tls_server_name',
    _('SNI'),
    _('The domain a client sends in the TLS handshake'),
  );
  o.placeholder = 'example.com';
  o.modalonly = true;
  o.rmempty = true;
  o.validate = function (sectionId: string, value: string) {
    if (isEmptyValue(value)) {
      return getEffectiveSecurity(sectionId) === 'reality'
        ? _('Reality needs an SNI')
        : true;
    }
    return validateHost(sectionId, value);
  };
  autofill(
    o,
    (sectionId: string) =>
      option(sectionId, 'tls_server_name') || camouflageSite(sectionId),
  );
  onTls(o);
  onReality(o);
  addGenerateButton(
    o,
    (sectionId: string) => camouflageSite(sectionId, true),
    _('Pick a domain'),
  );

  // Only where the listener leaves the choice open. Hysteria2 negotiates h3 and
  // NaiveProxy h2 on their own - both replace an empty list and fight a filled one -
  // and a TUIC client never looks at it.
  o = section.option(form.MultiValue, 'tls_alpn', _('ALPN'));
  ['h3', 'h2', 'http/1.1'].forEach((value: string) => o.value(value, value));
  o.create = false;
  o.rmempty = true;
  o.modalonly = true;
  ALPN_PROTOCOLS.forEach((protocol: string) =>
    (protocolSpec(protocol)?.securities || []).includes('none')
      ? o.depends({ protocol, security: 'tls' })
      : o.depends('protocol', protocol),
  );
  onReality(o);

  o = section.option(
    form.Value,
    'tls_certificate_path',
    _('Certificate path'),
    _('A certificate issued for this address'),
  );
  addCertificateButton(o);
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validateTlsCertificatePath;
  onTls(o);

  o = section.option(
    form.Value,
    'tls_key_path',
    _('Key path'),
    _('The private key of the certificate'),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validateTlsKeyPath;
  onTls(o);

  o = section.option(
    form.Value,
    'reality_private_key',
    _('Reality private key'),
    _('Required. Generate a pair with the button'),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.password = true;
  o.validate = validateRealityKey;
  autofill(
    o,
    (sectionId: string) =>
      option(sectionId, 'reality_private_key') ||
      realityKeypair(sectionId).then(
        (pair: { private_key?: string; public_key?: string } | null) =>
          pair ? pair.private_key : '',
      ),
  );
  onReality(o);
  addRealityKeypairButton(o);

  o = section.option(
    form.Value,
    'reality_public_key',
    _('Reality public key'),
    _('Filled in together with the private key'),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validateRealityKey;
  autofill(
    o,
    (sectionId: string) =>
      option(sectionId, 'reality_public_key') ||
      realityKeypair(sectionId).then(
        (pair: { private_key?: string; public_key?: string } | null) =>
          pair ? pair.public_key : '',
      ),
  );
  onReality(o);

  o = section.option(form.Value, 'reality_short_id', _('Reality short ID'));
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validateShortId;
  autofill(
    o,
    // A configuration written before this was one field keeps its first value.
    (sectionId: string) =>
      optionList(sectionId, 'reality_short_id')[0] || randomHex(4),
  );
  onReality(o);
  addGenerateButton(o, () => randomHex(4));

  o = section.option(
    form.ListValue,
    'client_fingerprint',
    _('Client fingerprint'),
  );
  CLIENT_FINGERPRINTS.forEach((value: string) => o.value(value, value));
  o.default = DEFAULT_CLIENT_FINGERPRINT;
  o.rmempty = true;
  o.modalonly = true;
  onReality(o);
}

export function addTransportOptions(section: CBISection) {
  const streamProtocols = protocolsWith('transport');
  const onTransport = (o: CBIOption, transport: string) =>
    streamProtocols.forEach((protocol: string) =>
      o.depends({ protocol, transport }),
    );

  let o = section.option(form.ListValue, 'transport', _('Transport'));
  TRANSPORTS.forEach(([value, label]) => o.value(value, label));
  o.default = 'tcp';
  o.rmempty = false;
  o.modalonly = true;
  streamProtocols.forEach((protocol: string) =>
    o.depends('protocol', protocol),
  );

  o = section.option(form.Value, 'transport_path', _('Transport path'));
  o.placeholder = '/ws';
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateTransportPath;
  ['ws', 'http', 'httpupgrade', 'xhttp'].forEach((transport: string) =>
    onTransport(o, transport),
  );

  o = section.option(form.Value, 'transport_host', _('Transport host'));
  o.placeholder = 'example.com';
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalHost;
  ['ws', 'httpupgrade', 'xhttp'].forEach((transport: string) =>
    onTransport(o, transport),
  );

  o = section.option(form.DynamicList, 'transport_hosts', _('HTTP hosts'));
  o.placeholder = 'example.com';
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateOptionalHostList;
  onTransport(o, 'http');

  o = section.option(form.Value, 'transport_service_name', _('gRPC service'));
  o.placeholder = 'grpc';
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validateGrpcServiceName;
  onTransport(o, 'grpc');

  o = section.option(form.ListValue, 'transport_xhttp_mode', _('XHTTP mode'));
  ['auto', 'packet-up', 'stream-up', 'stream-one'].forEach((value: string) =>
    o.value(value, value),
  );
  o.default = 'auto';
  o.rmempty = false;
  o.modalonly = true;
  onTransport(o, 'xhttp');
}

export function addTuningOptions(section: CBISection) {
  const o = section.option(form.Flag, 'tcp_fast_open', _('TCP Fast Open'));
  o.default = '0';
  o.rmempty = true;
  o.modalonly = true;
  protocolsWith('tcp').forEach((protocol: string) =>
    o.depends('protocol', protocol),
  );
}

export function addMultiplexOptions(section: CBISection) {
  const multiplexProtocols = protocolsWith('multiplex');
  const onMultiplex = (o: CBIOption, extra?: Record<string, unknown>) =>
    multiplexProtocols.forEach((protocol: string) =>
      o.depends(Object.assign({ protocol }, extra || {})),
    );

  let o = section.option(form.Flag, 'multiplex_enabled', _('Multiplex'));
  o.default = '0';
  o.rmempty = true;
  o.modalonly = true;
  onMultiplex(o);

  o = section.option(form.Flag, 'multiplex_padding', _('Padding'));
  o.default = '0';
  o.rmempty = true;
  o.modalonly = true;
  onMultiplex(o, { multiplex_enabled: '1' });
}
