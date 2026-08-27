// Every UCI option the Servers dialog asks for, listed once.
//
// A server writes a sing-box inbound directly, so a field that disappears from
// the dialog is a setting the user silently stops being able to reach, and a
// field added without a decision is one nothing has agreed to store. Both show
// up here: the list below is the decision, and the dialog is read for what it
// actually declares.
//
// What the generator does with these - whether the key it emits is an option
// sing-box has at all - is the other half, and it needs the core's own option
// structs: tests/config/server_option_contract.sh.
import { expect, it } from 'vitest';

import { tabSource } from '../lib/tabSource.js';

const FORM_OPTIONS = [
  '_protocol_display',
  'authorized_keys',
  'client_fingerprint',
  'clients',
  'enabled',
  'flow',
  'hysteria2_down_mbps',
  'hysteria2_ignore_client_bandwidth',
  'hysteria2_masquerade',
  'hysteria2_obfs_password',
  'hysteria2_obfs_type',
  'hysteria2_up_mbps',
  'inbound_json',
  'label',
  'listen',
  'listen_port',
  'mieru_transport',
  'mixed_auth_enabled',
  'mtproto_faketls',
  'multiplex_enabled',
  'multiplex_padding',
  'naive_network',
  'name',
  'open_firewall',
  'protocol',
  'public_host',
  'reality_private_key',
  'reality_public_key',
  'reality_short_id',
  'routing_mode',
  'routing_override',
  'routing_section',
  'security',
  'shadowsocks_method',
  'shadowsocks_psk',
  'ssh_host_key_path',
  'tailscale_accept_routes',
  'tailscale_advertise_routes',
  'tailscale_auth_key',
  'tailscale_control_url',
  'tailscale_detour_enabled',
  'tailscale_detour_section',
  'tailscale_ephemeral',
  'tailscale_hostname',
  'tcp_fast_open',
  'tls_alpn',
  'tls_certificate_path',
  'tls_key_path',
  'tls_server_name',
  'transport',
  'transport_host',
  'transport_hosts',
  'transport_path',
  'transport_service_name',
  'transport_xhttp_mode',
  'tuic_congestion_control',
  'tuic_heartbeat',
  'tuic_zero_rtt_handshake',
];

it('the Servers dialog asks for exactly the options this list names', async () => {
  const declared = new Set(
    [
      ...(await tabSource('servers')).matchAll(
        /\.option\(\s*(?:form\.)?[A-Za-z][A-Za-z0-9_]*\s*,\s*'([a-z0-9_]+)'/g,
      ),
    ].map((match) => match[1]),
  );

  expect(
    FORM_OPTIONS.filter((name) => !declared.has(name)).join(', '),
    'the dialog stopped asking for',
  ).toBe('');
  expect(
    [...declared].filter((name) => !FORM_OPTIONS.includes(name)).join(', '),
    'the dialog asks for options this contract does not list',
  ).toBe('');
});
