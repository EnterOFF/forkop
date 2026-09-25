// The protocols a subscription can deliver, mirroring
// FILTERABLE_PROVIDER_TYPES in the backend. sing-box builds provider nodes from
// outbounds only, so endpoint protocols never appear here.
export function providerTypeChoices() {
  return [
    ['vless', 'VLESS'],
    ['vmess', 'VMess'],
    ['trojan', 'Trojan'],
    ['shadowsocks', 'Shadowsocks'],
    ['hysteria2', 'Hysteria2'],
    ['hysteria', 'Hysteria'],
    ['tuic', 'TUIC'],
    ['anytls', 'AnyTLS'],
    ['naive', 'NaiveProxy'],
    ['mieru', 'Mieru'],
    ['snell', 'Snell'],
    ['shadowtls', 'ShadowTLS'],
    ['sudoku', 'Sudoku'],
    ['trusttunnel', 'TrustTunnel'],
    ['masque', 'MASQUE'],
    ['ssh', 'SSH'],
    ['tor', 'Tor'],
    ['socks', 'SOCKS'],
    ['http', 'HTTP'],
  ].map(([value, label]) => ({ value, label }));
}

// A group also holds the servers a section configures itself, which is the only
// way a tunnel or a network interface becomes a member.
export function groupTypeChoices() {
  return [
    ...providerTypeChoices(),
    ...[
      ['wireguard', 'WireGuard'],
      ['amneziawg', 'AmneziaWG'],
      ['warp', 'WARP'],
      ['tailscale', 'Tailscale'],
      ['openvpn-client', 'OpenVPN'],
      ['openconnect', 'OpenConnect'],
      ['direct', _('Network interface')],
    ].map(([value, label]) => ({ value, label })),
  ];
}
