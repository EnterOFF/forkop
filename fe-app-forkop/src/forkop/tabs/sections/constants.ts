export const RULE_SET_ITEM_SETTINGS_KEY = 'rule_set_settings';

export const ROUTING_ACTIONS = [
  'connection',
  'proxy',
  'outbound',
  'vpn',
  'bypass',
  'block',
];

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
  'connection_link',
  'subscription_url',
  'interfaces',
  'tunnels',
  'outbound_jsons',
];
