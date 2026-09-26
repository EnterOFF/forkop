let t = require("t");
let v = require("validation");

t.test("accepts valid", () => {
    v.accepts({
        "settings": {
            "list_update_enabled": "1",
            "update_interval": "1d",
            "latency_test_url": "https://latency.example/generate_204",
            "dns_server": [
                "https://dns.google/dns-query",
                "tls://cloudflare-dns.com",
                "quic://dns.adguard-dns.com",
                "h3://dns.google/dns-query",
                "tcp://8.8.8.8",
                "1.1.1.1"
            ],
            "bootstrap_dns_server": [
                "https://1.1.1.1/dns-query",
                "tcp://8.8.8.8"
            ],
            "dns_main_fallback_strategy": "sequential",
            "dns_bootstrap_fallback_strategy": "parallel",
            "dns_strategy": "prefer_ipv6",
            "dns_detour_enabled": "1",
            "dns_detour_section": "proxy",
            "download_lists_via_proxy": "1",
            "download_lists_via_proxy_section": "proxy"
        },
        "section": [
            {
                ".name": "detour",
                "enabled": "1",
                "action": "outbound",
                "outbound_json": "{\"type\":\"direct\"}",
                "domain_suffix": [
                    "detour.example"
                ]
            },
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "proxy",
                "ports": [
                    "80",
                    "1000-2000"
                ],
                "subscription_urls": [
                    "https://example.com/sub.txt"
                ],
                "subscription_url_settings": "{\"https://example.com/sub.txt\":{\"user_agent\":\"Agent/1.0\"}}",
                "subscription_update_enabled": "1",
                "subscription_update_interval": "12h",
                "urltest_enabled": "1",
                "urltest_check_interval": "3m",
                "urltest_server_filter_mode": "include",
                "urltest_tolerance": "10000",
                "urltest_testing_url": "https://urltest.example/generate_204",
                "urltest_include_regex": "🇺🇸",
                "urltest_exclude_regex": "bad.*",
                "domain": "commented.example # keep this note\nfull:exact-comment.example // and this note\nkeyword:clip",
                "domain_suffix": [
                    "example.org",
                    "сайт.рф",
                    "full:exact.example",
                    "full:full:legacy.example",
                    "full:пример.испытание",
                    "keyword:video",
                    "keyword:пример",
                    "regex:^api[.]example$",
                    "regex:^сайт[.]рф$"
                ],
                "domain_suffix_text": "text.example\nmünich.example\nkeyword:stream",
                "community_lists": [
                    "discord"
                ],
                "rule_set": [
                    "https://example.com/rules.srs"
                ],
                "rule_set_with_subnets": [
                    "/tmp/local.json",
                    "https://example.com/mixed.lst"
                ],
                "outbound_detour_enabled": "1",
                "outbound_detour_section": "detour"
            },
            {
                ".name": "bypass",
                "enabled": "1",
                "action": "bypass",
                "domain_suffix": [
                    "bypass.example"
                ]
            },
            {
                ".name": "custom_dns",
                "enabled": "1",
                "action": "dns",
                "dns_server": [
                    "tls://9.9.9.9:5353",
                    "https://1.1.1.1/dns-query"
                ],
                "dns_fallback_strategy": "sequential",
                "dns_detour_enabled": "1",
                "dns_detour_section": "proxy",
                "domain_suffix": [
                    "dns.example"
                ],
                "rule_set": [
                    "https://example.com/domain-only.srs",
                    "https://example.com/domains.lst"
                ]
            },
            {
                ".name": "device_dns",
                "enabled": "1",
                "action": "dns",
                "dns_server": [
                    "1.1.1.1"
                ],
                "fully_routed_ips": [
                    "192.0.2.2/32"
                ]
            }
        ],
        "section_interface": [
            {
                ".name": "resolver_interface",
                "section": "detour",
                "name": "wg0",
                "domain_resolver_enabled": "1",
                "domain_resolver_dns_server": [
                    "https://dns.google/dns-query",
                    "tls://1.1.1.1"
                ],
                "domain_resolver_dns_fallback_strategy": "sequential",
                "domain_resolver_dns_detour_enabled": "1",
                "domain_resolver_dns_detour_section": "proxy"
            }
        ],
        "server": [
            {
                ".name": "srv",
                "enabled": "1",
                "protocol": "vless",
                "security": "none",
                "listen_port": "18443",
                "public_host": "203.0.113.9",
                "routing_mode": "section",
                "routing_section": "proxy"
            }
        ],
        "server_client": [
            {
                ".name": "srv_phone",
                "server": "srv",
                "enabled": "1",
                "name": "phone",
                "uuid": "11111111-1111-4111-8111-111111111111"
            }
        ]
    });
});

t.test("accepts valid-json-endpoint", () => {
    v.accepts({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "tunnel": [
            {
                ".name": "tun_json",
                "section": "proxy",
                "kind": "json",
                "endpoint_json": "{\"type\":\"vpn-client\",\"tag\":\"vpn-client\"}"
            }
        ],
        "server": [
            {
                ".name": "json",
                "enabled": "1",
                "protocol": "json_inbound",
                "inbound_json": "{\"type\":\"mixed\"}"
            }
        ]
    });
});

t.test("non-canonical JSON outbound type", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "connection",
                "outbound_jsons": [
                    "{\"type\":\"SOCKS \",\"tag\":\"proxy\",\"server\":\"127.0.0.1\",\"server_port\":1080}"
                ]
            }
        ]
    }, "lowercase type fields without surrounding whitespace");
});

t.test("JSON endpoint with inbound type", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "tunnel": [
            {
                ".name": "tun_json",
                "section": "proxy",
                "kind": "json",
                "endpoint_json": "{\"type\":\"vless\",\"tag\":\"wrong-container\"}"
            }
        ]
    }, "unsupported JSON endpoint type 'vless'");
});

t.test("JSON inbound with endpoint type", () => {
    v.refuses({
        "settings": {},
        "server": [
            {
                ".name": "wg",
                "enabled": "1",
                "protocol": "json_inbound",
                "inbound_json": "{\"type\":\"wireguard\"}"
            }
        ]
    }, "unsupported JSON inbound type 'wireguard'");
});

t.test("accepts tailscale-without-exit-node", () => {
    v.accepts({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "tunnel": [
            {
                ".name": "tun_tailnet",
                "section": "proxy",
                "kind": "tailscale",
                "name": "Tailnet",
                "tailscale_auth_key": "tskey-auth-test",
                "tailscale_hostname": "forkop-router"
            }
        ]
    });
});

t.test("Tailscale tunnel without auth key", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "tunnel": [
            {
                ".name": "tun_tailnet",
                "section": "proxy",
                "kind": "tailscale",
                "name": "Tailnet",
                "tailscale_hostname": "forkop-router"
            }
        ]
    }, "incomplete Tailscale endpoint");
});

t.test("Tailscale tunnel self detour", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "tunnel": [
            {
                ".name": "tun_tailnet",
                "section": "proxy",
                "kind": "tailscale",
                "name": "Tailnet",
                "tailscale_auth_key": "tskey-auth-test",
                "tailscale_hostname": "forkop-router",
                "tailscale_exit_node": "100.64.0.1",
                "tailscale_detour_section": "proxy"
            }
        ]
    }, "cannot use itself for the Tailscale control plane");
});

t.test("bad DNS fallback strategy", () => {
    v.refuses({
        "settings": {
            "dns_server": [
                "1.1.1.1",
                "8.8.8.8"
            ],
            "bootstrap_dns_server": [
                "77.88.8.8"
            ],
            "dns_main_fallback_strategy": "random"
        },
        "section": []
    }, "Unsupported DNS fallback strategy 'random'");
});

t.test("bad DNS server", () => {
    v.refuses({
        "settings": {
            "dns_server": [
                "1.1.1.1",
                "bad value"
            ],
            "bootstrap_dns_server": [
                "77.88.8.8"
            ]
        },
        "section": []
    }, "Invalid main DNS server");
});

t.test("domain Bootstrap DNS", () => {
    v.refuses({
        "settings": {
            "dns_server": [
                "1.1.1.1"
            ],
            "bootstrap_dns_server": [
                "bootstrap.example.com"
            ]
        },
        "section": []
    }, "must use an IP address");
});

t.test("bad DNS strategy", () => {
    v.refuses({
        "settings": {
            "dns_strategy": "auto"
        },
        "section": []
    }, "Unsupported DNS strategy 'auto'");
});

t.test("empty main DNS list", () => {
    v.refuses({
        "settings": {
            "dns_server": [],
            "bootstrap_dns_server": [
                "77.88.8.8"
            ]
        },
        "section": []
    }, "At least one main DNS server is required");
});

t.test("empty Bootstrap DNS list", () => {
    v.refuses({
        "settings": {
            "dns_server": [
                "77.88.8.8"
            ],
            "bootstrap_dns_server": []
        },
        "section": []
    }, "At least one Bootstrap DNS server is required");
});

t.test("DNS detour bypass", () => {
    v.refuses({
        "settings": {
            "dns_detour_enabled": "1",
            "dns_detour_section": "bypass"
        },
        "section": [
            {
                ".name": "bypass",
                "enabled": "1",
                "action": "bypass"
            }
        ]
    }, "unsupported action 'bypass'");
});

t.test("bad direct action", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "old",
                "enabled": "1",
                "action": "direct"
            }
        ]
    }, "unsupported action 'direct'");
});

t.test("an empty Connection rule is accepted and logged as an error", () => {
    let result = v.accepts({
        "settings": {},
        "section": [
            {
                ".name": "empty",
                "enabled": "1",
                "action": "connection"
            }
        ]
    });
    t.contains(result.logs, "[error] Connection rule 'empty' has no configured outbounds.");
});

t.test("bad DNS rule server", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "dns",
                "enabled": "1",
                "action": "dns",
                "dns_server": "bad value",
                "domain_suffix": [
                    "example.org"
                ]
            }
        ]
    }, "invalid DNS server");
});

t.test("bad DNS rule protocol", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "dns",
                "enabled": "1",
                "action": "dns",
                "dns_server": [
                    "http://9.9.9.9/dns-query"
                ],
                "domain_suffix": [
                    "example.org"
                ]
            }
        ]
    }, "unsupported DNS server URI scheme 'http'");
});

t.test("bad DNS rule fallback strategy", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "dns",
                "enabled": "1",
                "action": "dns",
                "dns_server": [
                    "9.9.9.9",
                    "1.1.1.1"
                ],
                "dns_fallback_strategy": "random",
                "domain_suffix": [
                    "example.org"
                ]
            }
        ]
    }, "unsupported fallback strategy 'random'");
});

t.test("DNS rule without domain matchers", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "dns",
                "enabled": "1",
                "action": "dns",
                "dns_server": "9.9.9.9"
            }
        ]
    }, "must contain at least one domain condition");
});

t.test("DNS rule subnet extraction", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "dns",
                "enabled": "1",
                "action": "dns",
                "dns_server": "9.9.9.9",
                "rule_set_with_subnets": [
                    "https://example.com/mixed.srs"
                ]
            }
        ]
    }, "domain-only rule sets");
});

t.test("DNS rule unsupported detour", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "dns",
                "enabled": "1",
                "action": "dns",
                "dns_server": "9.9.9.9",
                "dns_detour_enabled": "1",
                "dns_detour_section": "bypass",
                "domain_suffix": [
                    "example.org"
                ]
            },
            {
                ".name": "bypass",
                "enabled": "1",
                "action": "bypass",
                "domain_suffix": [
                    "bypass.example"
                ]
            }
        ]
    }, "unsupported action 'bypass'");
});

t.test("bad interface resolver server", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "vpn",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "section_interface": [
            {
                ".name": "iface",
                "section": "vpn",
                "name": "wg0",
                "domain_resolver_enabled": "1",
                "domain_resolver_dns_server": [
                    "http://dns.example"
                ]
            }
        ]
    }, "unsupported DNS server URI scheme 'http'");
});

t.test("bad interface resolver query mode", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "vpn",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "section_interface": [
            {
                ".name": "iface",
                "section": "vpn",
                "name": "wg0",
                "domain_resolver_enabled": "1",
                "domain_resolver_dns_server": [
                    "1.1.1.1",
                    "8.8.8.8"
                ],
                "domain_resolver_dns_fallback_strategy": "random"
            }
        ]
    }, "unsupported fallback strategy 'random'");
});

t.test("interface resolver detour without a section", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "vpn",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "section_interface": [
            {
                ".name": "iface",
                "section": "vpn",
                "name": "wg0",
                "domain_resolver_enabled": "1",
                "domain_resolver_dns_server": [
                    "1.1.1.1"
                ],
                "domain_resolver_dns_detour_enabled": "1"
            }
        ]
    }, "routes DNS through a section, but no section is selected");
});

t.test("interface resolver detour through its own section", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "vpn",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "section_interface": [
            {
                ".name": "iface",
                "section": "vpn",
                "name": "wg0",
                "domain_resolver_enabled": "1",
                "domain_resolver_dns_server": [
                    "1.1.1.1"
                ],
                "domain_resolver_dns_detour_enabled": "1",
                "domain_resolver_dns_detour_section": "vpn"
            }
        ]
    }, "cannot use its own section as a DNS detour");
});

t.test("interface resolver detour with an unsupported action", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "vpn",
                "enabled": "1",
                "action": "connection"
            },
            {
                ".name": "bypass",
                "enabled": "1",
                "action": "bypass",
                "domain_suffix": [
                    "bypass.example"
                ]
            }
        ],
        "section_interface": [
            {
                ".name": "iface",
                "section": "vpn",
                "name": "wg0",
                "domain_resolver_enabled": "1",
                "domain_resolver_dns_server": [
                    "1.1.1.1"
                ],
                "domain_resolver_dns_detour_enabled": "1",
                "domain_resolver_dns_detour_section": "bypass"
            }
        ]
    }, "unsupported action 'bypass'");
});

t.test("bad port", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "proxy",
                "ports": [
                    "70000"
                ]
            }
        ]
    }, "Invalid port condition '70000'");
});

t.test("bad subscription", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "proxy",
                "subscription_urls": [
                    "https://example.com/a| Agent"
                ]
            }
        ]
    }, "Configure User-Agent in the subscription headers");
});

t.test("bad local subscription", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "proxy",
                "subscription_urls": [
                    "relative/subscription.txt"
                ]
            }
        ]
    }, "absolute local path");
});

t.test("bad subscription header", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "subscription_url": [
            {
                ".name": "proxy_sub_1",
                "section": "proxy",
                "url": "https://example.com/sub.txt",
                "header": [
                    "Broken Header: value"
                ]
            }
        ]
    }, "invalid header 1");
});

t.test("bad latency URL", () => {
    v.refuses({
        "settings": {
            "latency_test_url": "ftp://example.com/ping"
        },
        "section": []
    }, "settings.latency_test_url");
});

t.test("bad URLTest tolerance", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "proxy",
                "urltest_enabled": "1",
                "urltest_tolerance": "10001"
            }
        ]
    }, "Use a number from 0 to 10000");
});

t.test("bad URLTest expected status", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "proxy"
            }
        ],
        "urltest": [
            {
                ".name": "fast",
                "section": "proxy",
                "name": "Fast",
                "expected_status": "600"
            }
        ]
    }, "invalid expected_status");
});

t.test("URLTest interval longer than idle timeout", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "proxy",
                "urltest_enabled": "1",
                "urltest_check_interval": "31m"
            }
        ]
    }, "check interval longer than its idle timeout");
});

t.test("reality server without an SNI", () => {
    v.refuses({
        "settings": {},
        "server": [
            {
                ".name": "srv",
                "enabled": "1",
                "protocol": "vless",
                "security": "reality",
                "listen_port": "18443",
                "public_host": "203.0.113.9",
                "reality_private_key": "QFHBoM6IJlBnPCUKLTBLKLKB1kNU9WPMBRnMOaHYQE0",
                "reality_public_key": "Zq5EJlBnPCUKLTBLKLKB1kNU9WPMBRnMOaHYQE0QFHA",
                "reality_short_id": "0a1b2c3d"
            }
        ],
        "server_client": [
            {
                ".name": "srv_phone",
                "server": "srv",
                "enabled": "1",
                "name": "phone",
                "uuid": "11111111-1111-4111-8111-111111111111"
            }
        ]
    }, "needs an SNI");
});

t.test("reality server without a key pair", () => {
    v.refuses({
        "settings": {},
        "server": [
            {
                ".name": "srv",
                "enabled": "1",
                "protocol": "vless",
                "security": "reality",
                "listen_port": "18443",
                "public_host": "203.0.113.9",
                "tls_server_name": "www.apple.com",
                "reality_short_id": "0a1b2c3d"
            }
        ],
        "server_client": [
            {
                ".name": "srv_phone",
                "server": "srv",
                "enabled": "1",
                "name": "phone",
                "uuid": "11111111-1111-4111-8111-111111111111"
            }
        ]
    }, "Generate a Reality key pair");
});

t.test("reality short ID with an odd digit count", () => {
    v.refuses({
        "settings": {},
        "server": [
            {
                ".name": "srv",
                "enabled": "1",
                "protocol": "vless",
                "security": "reality",
                "listen_port": "18443",
                "public_host": "203.0.113.9",
                "tls_server_name": "www.apple.com",
                "reality_private_key": "QFHBoM6IJlBnPCUKLTBLKLKB1kNU9WPMBRnMOaHYQE0",
                "reality_public_key": "Zq5EJlBnPCUKLTBLKLKB1kNU9WPMBRnMOaHYQE0QFHA",
                "reality_short_id": "abc"
            }
        ],
        "server_client": [
            {
                ".name": "srv_phone",
                "server": "srv",
                "enabled": "1",
                "name": "phone",
                "uuid": "11111111-1111-4111-8111-111111111111"
            }
        ]
    }, "even number of hex digits");
});

t.test("MTProto server without a FakeTLS host", () => {
    v.refuses({
        "settings": {},
        "server": [
            {
                ".name": "srv",
                "enabled": "1",
                "protocol": "mtproto",
                "listen_port": "18442",
                "public_host": "203.0.113.9"
            }
        ],
        "server_client": [
            {
                ".name": "srv_phone",
                "server": "srv",
                "name": "phone",
                "secret": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            }
        ]
    }, "needs a FakeTLS host");
});

t.test("TLS server without a certificate", () => {
    v.refuses({
        "settings": {},
        "server": [
            {
                ".name": "srv",
                "enabled": "1",
                "protocol": "hysteria2",
                "listen_port": "18443",
                "public_host": "203.0.113.9"
            }
        ],
        "server_client": [
            {
                ".name": "srv_phone",
                "server": "srv",
                "name": "phone",
                "password": "secret-password"
            }
        ]
    }, "tls_certificate_path");
});

t.test("SSH server without a host key", () => {
    v.refuses({
        "settings": {},
        "server": [
            {
                ".name": "srv",
                "enabled": "1",
                "protocol": "ssh",
                "listen_port": "18422",
                "public_host": "203.0.113.9"
            }
        ],
        "server_client": [
            {
                ".name": "srv_phone",
                "server": "srv",
                "name": "phone",
                "password": "secret-password"
            }
        ]
    }, "ssh_host_key_path");
});

t.test("hysteria2 obfuscation without a password", () => {
    v.refuses({
        "settings": {},
        "server": [
            {
                ".name": "srv",
                "enabled": "1",
                "protocol": "hysteria2",
                "listen_port": "18444",
                "public_host": "203.0.113.9",
                "tls_certificate_path": "/etc/forkop/server-certs/srv.crt",
                "tls_key_path": "/etc/forkop/server-certs/srv.key",
                "hysteria2_obfs_type": "salamander"
            }
        ],
        "server_client": [
            {
                ".name": "srv_phone",
                "server": "srv",
                "enabled": "1",
                "name": "phone",
                "password": "secret"
            }
        ]
    }, "obfuscation password");
});

t.test("bad server routing bypass", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "bypass",
                "enabled": "1",
                "action": "bypass"
            }
        ],
        "server": [
            {
                ".name": "srv",
                "enabled": "1",
                "protocol": "vless",
                "security": "none",
                "listen_port": "18443",
                "public_host": "203.0.113.9",
                "routing_mode": "section",
                "routing_section": "bypass"
            }
        ],
        "server_client": [
            {
                ".name": "srv_phone",
                "server": "srv",
                "enabled": "1",
                "name": "phone",
                "uuid": "11111111-1111-4111-8111-111111111111"
            }
        ]
    }, "unsupported action 'bypass'");
});

t.test("bad server routing block", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "block",
                "enabled": "1",
                "action": "block"
            }
        ],
        "server": [
            {
                ".name": "srv",
                "enabled": "1",
                "protocol": "vless",
                "security": "none",
                "listen_port": "18443",
                "public_host": "203.0.113.9",
                "routing_mode": "section",
                "routing_section": "block"
            }
        ],
        "server_client": [
            {
                ".name": "srv_phone",
                "server": "srv",
                "enabled": "1",
                "name": "phone",
                "uuid": "11111111-1111-4111-8111-111111111111"
            }
        ]
    }, "unsupported action 'block'");
});

t.test("server without clients", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "server": [
            {
                ".name": "srv",
                "enabled": "1",
                "protocol": "vless",
                "security": "none",
                "listen_port": "18443",
                "public_host": "203.0.113.9"
            }
        ]
    }, "has no clients");
});

// The dialog writes the switch on by default, and a listener that asks for
// nothing is an open proxy on a port the firewall opens: a section written
// without the switch is authenticated too.
t.test("a Tailscale server advertises addresses and subnets only", () => {
    let data = (routes) => ({
        section: [ { ".name": "main", enabled: "1", action: "connection", selector_proxy_links: [ "socks://127.0.0.1:1080#one" ] } ],
        server: [ { ".name": "tail", enabled: "1", protocol: "tailscale", tailscale_auth_key: "tskey-auth-test", routing_mode: "direct",
            tailscale_advertise_routes: routes } ]
    });
    v.accepts(data([ "192.168.1.10", "192.168.2.0/24", "fd00::/64" ]));
    v.refuses(data([ "192.168.1.0/33" ]), "advertises '192.168.1.0/33', which is not an address or a subnet");
});

t.test("a listen address with a leading zero is refused, as sing-box refuses it", () => {
    v.refuses({
        section: [ { ".name": "main", enabled: "1", action: "connection", selector_proxy_links: [ "socks://127.0.0.1:1080#one" ] } ],
        server: [ { ".name": "srv", enabled: "1", protocol: "mixed", listen: "192.168.01.1", listen_port: "18080", mixed_auth_enabled: "0", routing_mode: "direct" } ]
    }, "listens on '192.168.01.1', which is not an IP address");
});

t.test("a Mixed server without the authentication switch asks for accounts", () => {
    let data = (extra) => ({
        section: [ { ".name": "main", enabled: "1", action: "connection", selector_proxy_links: [ "socks://127.0.0.1:1080#one" ] } ],
        server: [ { ".name": "srv", enabled: "1", protocol: "mixed", listen_port: "18080", routing_mode: "direct", ...extra } ]
    });
    v.refuses(data({}), "has no clients");
    v.accepts(data({ mixed_auth_enabled: "0" }));
});

t.test("server client with a broken UUID", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "server": [
            {
                ".name": "srv",
                "enabled": "1",
                "protocol": "vless",
                "security": "none",
                "listen_port": "18443",
                "public_host": "203.0.113.9"
            }
        ],
        "server_client": [
            {
                ".name": "srv_phone",
                "server": "srv",
                "enabled": "1",
                "name": "phone",
                "uuid": "not-a-uuid"
            }
        ]
    }, "has an invalid UUID");
});

t.test("account name with a space", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "server": [
            {
                ".name": "srv",
                "enabled": "1",
                "protocol": "mixed",
                "mixed_auth_enabled": "1",
                "listen_port": "18080",
                "public_host": "203.0.113.9"
            }
        ],
        "server_client": [
            {
                ".name": "srv_phone",
                "server": "srv",
                "enabled": "1",
                "name": "alice smith",
                "password": "secret"
            }
        ]
    }, "must contain only letters");
});

t.test("Shadowsocks 2022 client key of the wrong length", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "server": [
            {
                ".name": "srv",
                "enabled": "1",
                "protocol": "shadowsocks",
                "shadowsocks_method": "2022-blake3-aes-128-gcm",
                "shadowsocks_psk": "c2VydmVyLXByZXNoYXJlZC1rZXk=",
                "listen_port": "18448",
                "public_host": "203.0.113.9"
            }
        ],
        "server_client": [
            {
                ".name": "srv_phone",
                "server": "srv",
                "enabled": "1",
                "name": "phone",
                "password": "plain-password"
            }
        ]
    }, "base64 pre-shared key of 16 bytes");
});

t.test("two servers on one port", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "server": [
            {
                ".name": "first",
                "enabled": "1",
                "protocol": "vless",
                "security": "none",
                "listen_port": "18443",
                "public_host": "203.0.113.9"
            },
            {
                ".name": "second",
                "enabled": "1",
                "protocol": "trojan",
                "listen_port": "18443",
                "public_host": "203.0.113.9",
                "security": "tls",
                "tls_certificate_path": "/etc/forkop/server-certs/second.crt",
                "tls_key_path": "/etc/forkop/server-certs/second.key"
            }
        ],
        "server_client": [
            {
                ".name": "first_phone",
                "server": "first",
                "enabled": "1",
                "name": "phone",
                "uuid": "11111111-1111-4111-8111-111111111111"
            },
            {
                ".name": "second_phone",
                "server": "second",
                "enabled": "1",
                "name": "phone",
                "password": "secret"
            }
        ]
    }, "which is already used by server 'first'");
});

t.test("server on a Forkop port", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "connection"
            }
        ],
        "server": [
            {
                ".name": "srv",
                "enabled": "1",
                "protocol": "vless",
                "security": "none",
                "listen_port": "1602",
                "public_host": "203.0.113.9"
            }
        ],
        "server_client": [
            {
                ".name": "srv_phone",
                "server": "srv",
                "enabled": "1",
                "name": "phone",
                "uuid": "11111111-1111-4111-8111-111111111111"
            }
        ]
    }, "already used by a Forkop inbound");
});

// A port is two sockets, one per transport: a TCP server and a UDP one share it.
t.test("servers share a port only on different transports", () => {
    let data = (servers) => ({
        section: [ { ".name": "main", enabled: "1", action: "connection", selector_proxy_links: [ "socks://127.0.0.1:1080#one" ] } ],
        server: servers,
        server_client: [ { ".name": "c1", server: "tcp443", name: "one", uuid: "11111111-1111-4111-8111-111111111111" },
            { ".name": "c2", server: "udp443", name: "one", password: "secret-one" },
            { ".name": "c3", server: "dup", name: "one", uuid: "22222222-2222-4222-8222-222222222222" } ]
    });
    let vless = { ".name": "tcp443", enabled: "1", protocol: "vless", security: "none", listen_port: "443", routing_mode: "direct" };
    let dir = require("stub").tmpdir();
    require("fs").writefile(dir + "/a.crt", "-----BEGIN CERTIFICATE-----
placeholder
-----END CERTIFICATE-----
");
    require("fs").writefile(dir + "/a.key", "-----BEGIN PRIVATE KEY-----
placeholder
-----END PRIVATE KEY-----
");
    let hysteria = { ".name": "udp443", enabled: "1", protocol: "hysteria2", listen_port: "443", routing_mode: "direct",
        tls_certificate_path: dir + "/a.crt", tls_key_path: dir + "/a.key" };
    v.refuses(data([ vless, { ...vless, ".name": "dup", listen_port: "0443" } ]), "listens on tcp port 443, which is already used by server 'tcp443'");
    v.refuses(data([ vless, { ".name": "json", enabled: "1", protocol: "json_inbound", routing_mode: "direct",
        inbound_json: "{\"type\":\"mixed\",\"listen\":\"0.0.0.0\",\"listen_port\":443}" } ]), "listens on tcp port 443");
    v.accepts(data([ vless, hysteria ]));
});

t.test("a server may not take the port the component manager downloads through", () => {
    v.refuses({
        section: [ { ".name": "main", enabled: "1", action: "connection", selector_proxy_links: [ "socks://127.0.0.1:1080#one" ] } ],
        server: [ { ".name": "srv", enabled: "1", protocol: "mixed", listen_port: "4535", mixed_auth_enabled: "0", routing_mode: "direct" } ]
    }, "already used by a Forkop inbound");
});

t.test("bad detour", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "first",
                "enabled": "1",
                "action": "proxy",
                "selector_proxy_links": [ "socks://127.0.0.1:1080#first" ],
                "outbound_detour_enabled": "1",
                "outbound_detour_section": "second"
            },
            {
                ".name": "second",
                "enabled": "1",
                "action": "proxy",
                "selector_proxy_links": [ "socks://127.0.0.1:1081#second" ],
                "outbound_detour_enabled": "1",
                "outbound_detour_section": "first"
            }
        ]
    }, "creates a cycle");
});

t.test("bad list reference", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "proxy",
                "rule_set": [
                    "ftp://example.com/list.lst"
                ]
            }
        ]
    }, "Unknown rule set reference");
});

t.test("bad filter regex", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "proxy",
                "urltest_enabled": "1",
                "urltest_server_filter_mode": "include",
                "urltest_include_regex": "["
            }
        ]
    }, "Invalid URLTest regular expression");
});

t.test("bad filter mode", () => {
    v.refuses({
        "settings": {},
        "section": [
            {
                ".name": "proxy",
                "enabled": "1",
                "action": "proxy"
            }
        ],
        "urltest": [
            {
                ".name": "bad",
                "section": "proxy",
                "name": "Bad mode",
                "server_filter_mode": "direct"
            }
        ]
    }, "Invalid server filter mode 'direct'");
});


function amnezia_tunnel(field, value, kind) {
    let tunnel = {
        ".name": "tun_amnezia", section: "tunnels", order: "0",
        kind: kind ?? "amneziawg", name: "Amnezia", address: [ "10.0.0.2/32" ],
        private_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    };
    if (type(field) == "object")
        tunnel = { ...tunnel, ...field };
    else
        tunnel[field] = value;
    return {
        settings: {},
        section: [ { ".name": "tunnels", enabled: "1", action: "connection" } ],
        tunnel: [ tunnel ],
        tunnel_peer: [ {
            ".name": "peer_amnezia", tunnel: "tun_amnezia", order: "0",
            address: "vpn.example.com", port: "51820",
            public_key: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=", allowed_ips: [ "0.0.0.0/0" ]
        } ]
    };
}

t.test("AmneziaWG numbers stay within their field width", () => {
    v.accepts(amnezia_tunnel("amnezia_s1", "65535"));
    v.refuses(amnezia_tunnel("amnezia_s1", "65536"), "invalid AmneziaWG s1 value");
    v.refuses(amnezia_tunnel("amnezia_jc", "4294967296"), "invalid AmneziaWG jc value");
});

t.test("AmneziaWG signatures are chains of known tags", () => {
    v.accepts(amnezia_tunnel("amnezia_i1", "<r 2><b 0x8580>"));
    v.refuses(amnezia_tunnel("amnezia_i1", "deadbeef"), "invalid AmneziaWG i1 signature");
    v.refuses(amnezia_tunnel("amnezia_i1", "<zz 1>"), "invalid AmneziaWG i1 signature");
});

t.test("a protected AmneziaWG header needs every padding of at least 12 bytes", () => {
    const KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
    v.refuses(amnezia_tunnel("amnezia_header_protection_key", KEY), "requires AmneziaWG s1 of at least 12 bytes");
    let padded = { amnezia_header_protection_key: KEY, amnezia_s1: "12", amnezia_s2: "12", amnezia_s3: "12", amnezia_s4: "12" };
    v.accepts(amnezia_tunnel(padded));
    for (let key in [ "s1", "s2", "s3", "s4" ])
        v.refuses(amnezia_tunnel({ ...padded, ["amnezia_" + key]: "11" }), "requires AmneziaWG " + key + " of at least 12 bytes");
    v.accepts(amnezia_tunnel("amnezia_header_protection_key", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="), "the all-zero key disables protection");
});

t.test("AmneziaWG flags are 0 or 1 on every kind that carries them", () => {
    v.refuses(amnezia_tunnel("amnezia_random_trailers", "maybe"), "invalid AmneziaWG random_trailers flag");
    for (let flag in [ "random_trailers", "disable_cookies" ])
        for (let value in [ "0", "1" ])
            v.accepts(amnezia_tunnel("amnezia_" + flag, value));
    for (let kind in [ "wireguard", "warp" ])
        v.refuses(amnezia_tunnel("amnezia_disable_cookies", "maybe", kind), "invalid AmneziaWG disable_cookies flag");
});

t.done();
