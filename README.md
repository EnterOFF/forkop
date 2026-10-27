# Forkop

Маршрутизация трафика OpenWrt по правилам.

[![Релиз](https://img.shields.io/github/v/release/ushan0v/forkop?label=%D1%80%D0%B5%D0%BB%D0%B8%D0%B7&color=0d9488)](https://github.com/ushan0v/forkop/releases/latest)
[![Документация](https://img.shields.io/badge/%D0%B4%D0%BE%D0%BA%D1%83%D0%BC%D0%B5%D0%BD%D1%82%D0%B0%D1%86%D0%B8%D1%8F-ushan0v.github.io-0d9488)](https://ushan0v.github.io/forkop/)
[![Чат в Telegram](https://img.shields.io/badge/Telegram-%D1%87%D0%B0%D1%82-2CA5E0?logo=telegram&logoColor=white)](https://t.me/forkop_chat)

[Установка](https://ushan0v.github.io/forkop/guide/install) · [Быстрый старт](https://ushan0v.github.io/forkop/guide/quick-start) · [Руководство](https://ushan0v.github.io/forkop/sections/)

## Требования

- OpenWrt 24.10 или новее;
- от 128 МБ оперативной памяти, лучше 256 МБ;
- от 18 до 38 МБ свободной флеш-памяти, в зависимости от [сборки ядра](https://ushan0v.github.io/forkop/guide/install#сборки-ядра).

## Установка

Подключитесь к роутеру по SSH и выполните:

```sh
sh <(wget -O - https://raw.githubusercontent.com/ushan0v/forkop/main/install.sh)
```

Команда устанавливает или обновляет [Forkop](https://github.com/ushan0v/forkop) и [sing-box-forkop](https://github.com/ushan0v/sing-box-forkop).

## Возможности

- **Секции** для точечной маршрутизации трафика по правилам и спискам.
- **Подключения** по ссылкам VLESS, Trojan, Shadowsocks, Hysteria2 и другим.
- **Подписки** с поддержкой всех основных форматов.
- **Туннели** WireGuard, AmneziaWG, Cloudflare WARP, OpenVPN и Tailscale.
- **URLTest и Fallback** сами выбирают рабочий сервер.
- **DNS** с шифрованием и DNS Fallback.
- **VPN-сервер** на самом роутере.
- **Дашборд и мониторинг** соединений.

## Документация

Вся документация на русском лежит на [ushan0v.github.io/forkop](https://ushan0v.github.io/forkop/).

## Помощь

Вопросы и помощь в [чате в Telegram](https://t.me/forkop_chat). Об ошибках и предложениях пишите в [Issues](https://github.com/ushan0v/forkop/issues).

## Поддержать проект

* 💳 **Карты РФ / СБП / Tinkoff Pay:** [Донат на CloudTips](https://pay.cloudtips.ru/p/385e5af2)
* 💎 **USDT (сеть TON):** `UQAOCDav39WJ2gvnzs9RQ_IsF2dcGrcpw4U0j6XGO7je7uwm`
* 🟢 **USDT (сеть TRC-20):** `TEMaZFyM8RQpkbd5LvB8CFJwxCyhHauKAe`
* 🪙 **USDT (сети ERC-20 / BEP-20 / Polygon / Monad):** `0xe8aabb21c320240fe45b6087e68c6fe40a92d8bf`
* 🟠 **USDT (сеть Solana):** `AhhUjTci9zDKQjUfgLacFR4LiHX9nmZud6DZ8YdbpjEB`

## Лицензия

Forkop распространяется по лицензии [GPL-2.0-or-later](LICENSE).
