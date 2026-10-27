# URI подключения

Ссылка на сервер в том виде, в каком её выдают VPN-сервисы и панели. Поле принимает такие схемы:

| Протокол | Схема | Сборка ядра |
| --- | --- | --- |
| VLESS, включая Reality, XTLS Vision и XHTTP | `vless://` | все |
| Trojan | `trojan://` | все |
| Shadowsocks, включая Shadowsocks 2022 | `ss://` | все |
| Hysteria2 | `hysteria2://`, `hy2://` | все |
| Hysteria | `hysteria://`, `hy://` | все |
| TUIC | `tuic://` | все |
| SOCKS | `socks://`, `socks5://`, `socks5h://`, `socks4://`, `socks4a://` | все |
| HTTP | `http://`, `https://` | все |
| VMess | `vmess://` | base, full |
| AnyTLS | `anytls://` | base, full |
| TrustTunnel | `tt://` | base, full |
| NaiveProxy | `naive+https://`, `naive+quic://`, `http2://`, `http3://` | full |
| mieru | `mieru://`, `mierus://` | full |

Ссылки `wireguard://` и профили Amnezia `vpn://` добавляются в поле **Туннель**, см. [Туннели](/tunnels/).

## Каскадное подключение

Каскад подключается к серверу через другую секцию. Например, провайдер блокирует ваш сервер, а WARP работает. Создайте секцию с туннелем WARP без условий и включите у ссылки **Каскадное подключение** через неё. Без условий секция не забирает ничей трафик и служит только звеном каскада.

Так же работает каскад у [подписок](/connections/subscriptions) и [туннелей](/tunnels/).
