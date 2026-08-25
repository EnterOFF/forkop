#!/usr/bin/env bash
set -eo pipefail

# Which sections count as a proxy outbound, which is what decides whether the
# requirements check reports that the router has none. Only a Connection section
# builds outbounds out of its subscriptions, tunnels and interfaces; a section
# that used to be one keeps them - the dialog does not throw a tunnel key away
# because an action changed - and counting those would claim an outbound the
# runtime has not got.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
VALIDATOR="$FORKOP_LIB/config/validator.uc"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

# A section of the given action, holding one subscription as a child item.
fixture() {
  local action="$1"
  local enabled="$2"
  local path="$WORK_DIR/fixture.json"

  cat >"$path" <<JSON
{
  "settings": { ".name": "settings", ".type": "settings" },
  "section": [
    {
      ".name": "sec",
      ".type": "section",
      "action": "$action",
      "enabled": "$enabled",
      "label": "sec"
    }
  ],
  "subscription_url": [
    {
      ".name": "sub",
      ".type": "subscription_url",
      "section": "sec",
      "url": "https://example.com/sub"
    }
  ]
}
JSON
  printf '%s\n' "$path"
}

present() {
  local context="${2:-\{\}}"
  ucode -L "$FORKOP_LIB" "$VALIDATOR" outbound-section-present-fixture "$1" "$context" >/dev/null
}

present "$(fixture connection 1)" ||
  fail "a Connection section with a subscription must count as a proxy outbound"

! present "$(fixture bypass 1)" ||
  fail "a Bypass section that kept a subscription must not count as a proxy outbound"

! present "$(fixture dns 1)" ||
  fail "a DNS section that kept a subscription must not count as a proxy outbound"

! present "$(fixture connection 0)" ||
  fail "a disabled Connection section must not count as a proxy outbound"

# A retired action keeps whatever the section stored, and none of it builds an
# outbound any more.
! present "$(fixture zapret 1)" ||
  fail "a section with a retired action must not count as a proxy outbound"

printf 'outbound section presence checks passed\n'
