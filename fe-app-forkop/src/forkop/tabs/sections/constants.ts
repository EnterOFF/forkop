export const RULE_SET_ITEM_SETTINGS_KEY = 'rule_set_settings';

export const ROUTING_ACTIONS = [
  'connection',
  'proxy',
  'outbound',
  'vpn',
  'bypass',
  'block',
];

export const JSON_ENDPOINT_TYPES = new Set([
  'vpn-server',
  'vpn-client',
  'wireguard',
  'amneziawg',
  'warp',
  'tailscale',
]);

// Shown greyed out in the JSON endpoint editor: the smallest object the
// validator and sing-box both accept, so the shape is read instead of
// described. The tag becomes the name the tunnel is listed under.
export const JSON_ENDPOINT_PLACEHOLDER = [
  '{',
  '  "type": "wireguard",',
  '  "tag": "my-endpoint",',
  '  "address": ["10.0.0.2/32"],',
  '  "private_key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="',
  '}',
].join('\n');

// Tags sing-box already uses for Forkop's own inbounds, outbounds and DNS servers.
// A section display name becomes a tag verbatim, so these names are refused here and
// by the runtime check, which reads singbox/constants.uc. The Servers tab keeps the
// same list of its own; the contract test holds both against that table.
export const RESERVED_RUNTIME_TAGS = new Set([
  'dns-server',
  'fakeip-server',
  'bootstrap-dns-server',
  'dnsmasq-server',
  'hosts-server',
  'fakeip-dns-rule-tag',
  'fakeip-ruleset-dns-rule-tag',
  'service-fakeip-dns-rule-tag',
  'tproxy-in',
  'tproxy6-in',
  'dns-in',
  'source-dns-in',
  'system-in',
  'system6-in',
  'system-dns-in',
  'service-mixed-in',
  'direct-out',
]);

export const CONNECTIONS_BLOCKED_INTERFACES = [
  'br-lan',
  'eth0',
  'eth1',
  'wan',
  'phy0-ap0',
  'phy1-ap0',
  'pppoe-wan',
  'lan',
];

// The servers a Connection section can reach. A URLTest or a Fallback is not one
// of them: a group only arranges the servers of its own section, so it draws its
// members from this same list. A section without any of them contributes no
// outbound and no route, and the generator leaves it out of the runtime graph
// entirely - so it is refused before it can be saved.
export const CONNECTION_OUTBOUND_SOURCES = [
  'selector_proxy_links',
  'subscription_url',
  'interfaces',
  'tunnels',
  'outbound_jsons',
];
