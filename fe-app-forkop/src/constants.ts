export const FORKOP_UCI_PACKAGE = 'forkop';
export const FORKOP_LUCI_APP_VERSION = '__COMPILED_VERSION_VARIABLE__';
export const FAKEIP_CHECK_DOMAIN = 'fakeip.podkop.fyi';
// Tags sing-box already uses for Forkop's own objects; a display name becomes a tag verbatim,
// so these are refused. The contract test holds this to singbox/constants.uc.
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
  'service-warp-in',
  'direct-out',
]);

// Actions whose section can carry another section's traffic.
export const DETOUR_TARGET_ACTIONS = ['connection'];

export const TAILSCALE_CONTROL_URL = 'https://controlplane.tailscale.com';

export const DEFAULT_LATENCY_TEST_URL = 'https://www.gstatic.com/generate_204';
export const LATENCY_TEST_URL_OPTIONS = [
  DEFAULT_LATENCY_TEST_URL,
  'https://cp.cloudflare.com/generate_204',
  'https://captive.apple.com',
  'https://connectivity-check.ubuntu.com',
];

export const DOMAIN_LIST_OPTIONS = {
  russia_inside: 'Russia inside',
  russia_outside: 'Russia outside',
  ukraine_inside: 'Ukraine',
  geoblock: 'Geo Block',
  block: 'Block',
  porn: 'Porn',
  news: 'News',
  anime: 'Anime',
  youtube: 'Youtube',
  discord: 'Discord',
  meta: 'Meta',
  twitter: 'Twitter (X)',
  hdrezka: 'HDRezka',
  tiktok: 'Tik-Tok',
  telegram: 'Telegram',
  cloudflare: 'Cloudflare',
  google_ai: 'Google AI',
  google_play: 'Google Play',
  hodca: 'H.O.D.C.A',
  roblox: 'Roblox',
  ads_hagezi_pro: 'Ads (Hagezi Pro)',
  supercell: 'Supercell',
  github: 'GitHub',
  hetzner: 'Hetzner ASN',
  ovh: 'OVH ASN',
  digitalocean: 'Digital Ocean ASN',
  cloudfront: 'CloudFront ASN',
};

export const COMMAND_TIMEOUT = 10000;
