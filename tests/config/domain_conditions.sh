#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

suffix() {
  ucode -L "$FORKOP_LIB" -e '
    let domain = require("config.domain");
    let value = domain.suffix_to_ascii(ARGV[0]);
    print(value == null ? "<null>" : value, "\n");
  ' -- "$1"
}

assert_suffix() {
  local value="$1" expected="$2" actual
  actual="$(suffix "$value")"
  [ "$actual" = "$expected" ] ||
    fail "suffix_to_ascii('$value'): expected '$expected', got '$actual'"
}

# A label that is already a valid ASCII label is normalised by lowercasing it,
# which is the shortcut label_to_ascii takes before the codepoint walk. These
# pin the boundary of that shortcut, because a label the shortcut wrongly claims
# would change every reload-state signature built from it.
assert_suffix example.com example.com
assert_suffix EXAMPLE.COM example.com
assert_suffix MiXeD-123.Example.CO.uk mixed-123.example.co.uk
assert_suffix .example.com .example.com
assert_suffix 123.456 123.456
assert_suffix "$(printf 'a%.0s' $(seq 63)).com" "$(printf 'a%.0s' $(seq 63)).com"

# Labels the shortcut must not claim: an ASCII label that is not a valid one is
# refused, not handed to the punycode encoder, which would turn -abc into the
# valid xn---abc and match a domain nobody wrote.
assert_suffix -abc.com '<null>'
assert_suffix "-$(printf 'a%.0s' $(seq 58)).com" '<null>'
assert_suffix abc-.com '<null>'
assert_suffix "$(printf 'a%.0s' $(seq 64)).com" '<null>'
assert_suffix under_score.com '<null>'
assert_suffix example.com. '<null>'
assert_suffix '' '<null>'

# Non-ASCII still has to reach the punycode encoder, in lowercase.
assert_suffix "пример.рф" "xn--e1afmkfd.xn--p1ai"
assert_suffix "ПРИМЕР.РФ" "xn--e1afmkfd.xn--p1ai"

conditions() {
  ucode -L "$FORKOP_LIB" -e '
    let rule = require("config.rule");
    let combined_text = ARGV[0];
    let combined_list = ARGV[1];
    let keys = [ "domain", "domain_suffix", "domain_keyword", "domain_regex" ];
    for (let key in keys)
      printf("%s=%s\n", key, rule.rule_condition_csv_value(
        key, key == "domain" || key == "domain_suffix" ? "domains" : "generic",
        "0", "0", "", "", combined_text, combined_list));
  ' -- "$1" "$2"
}

TEXT_A='full:a.example
b.example
keyword:ads
regex:^tracker\.
'
TEXT_B='full:c.example
d.example
keyword:beacon
'

expected_a='domain=a.example
domain_suffix=b.example
domain_keyword=ads
domain_regex=^tracker\.'
actual_a="$(conditions "$TEXT_A" "")"
[ "$actual_a" = "$expected_a" ] ||
  fail "combined domain text must split by kind, got: $actual_a"

# The four kinds of one section are answered from a single classification pass,
# so a wrong cache key would hand a section the values of the previous one. Both
# texts are asked for in the same process, interleaved.
interleaved="$(ucode -L "$FORKOP_LIB" -e '
  let rule = require("config.rule");
  let keys = [ "domain", "domain_suffix", "domain_keyword", "domain_regex" ];
  for (let round = 0; round < 2; round++)
    for (let key in keys)
      for (let i = 0; i < 2; i++)
        printf("%d/%s=%s\n", i, key, rule.rule_condition_csv_value(
          key, key == "domain" || key == "domain_suffix" ? "domains" : "generic",
          "0", "0", "", "", ARGV[i], ""));
' -- "$TEXT_A" "$TEXT_B")"

for expectation in \
  '0/domain=a.example' '1/domain=c.example' \
  '0/domain_suffix=b.example' '1/domain_suffix=d.example' \
  '0/domain_keyword=ads' '1/domain_keyword=beacon' \
  '0/domain_regex=^tracker\.' '1/domain_regex='; do
  count="$(printf '%s\n' "$interleaved" | grep -Fxc -- "$expectation" || true)"
  [ "$count" = "2" ] ||
    fail "interleaved sections must each keep their own values: '$expectation' seen $count times"
done

# The whitespace-separated list form carries the same prefixes and is classified
# the same way.
expected_list='domain=e.example
domain_suffix=f.example
domain_keyword=beacon
domain_regex='
actual_list="$(conditions "" "full:e.example f.example keyword:beacon")"
[ "$actual_list" = "$expected_list" ] ||
  fail "combined domain list must split by kind, got: $actual_list"

printf 'Domain condition checks passed\n'

# The same owner answers the legacy per-kind form and the subnet kind, which is
# what the nftables builders read a section's addresses through. These used to be
# driven through a CLI mode of nft/apply.uc, which owned neither.
condition_csv() {
  ucode -L "$FORKOP_LIB" -e '
    let rule = require("config.rule");
    print(rule.rule_condition_csv_value(ARGV[0], ARGV[1], ARGV[2], ARGV[3], ARGV[4], ARGV[5], ARGV[6], ARGV[7]), "\n");
  ' -- "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8"
}

legacy_csv() {
  ucode -L "$FORKOP_LIB" -e '
    let rule = require("config.rule");
    print(rule.legacy_condition_csv_value(ARGV[0], ARGV[1], ARGV[2], ARGV[3], ARGV[4]), "\n");
  ' -- "$1" "$2" "$3" "$4" "$5"
}

assert_csv() {
  local expected="$1" actual="$2" label="$3"
  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
}

assert_csv "198.51.100.1,203.0.113.0/24" \
  "$(legacy_csv subnets 1 0 $'198.51.100.1\nbad-value\n203.0.113.0/24' '10.0.0.0/8')" \
  "legacy text-mode subnets drop what is not an address"
assert_csv "10.0.0.0/8,192.0.2.1" \
  "$(legacy_csv subnets 0 0 '198.51.100.1' '10.0.0.0/8 192.0.2.1')" \
  "legacy list priority"
assert_csv "one.example,list.example,legacy.example" \
  "$(condition_csv domain domains 0 0 legacy.example '' 'full:one.example keyword:skip regex:^skip suffix.example' 'full:list.example keyword:list-skip')" \
  "combined domain plus legacy"
assert_csv "suffix.example,list.example" \
  "$(condition_csv domain_suffix domains 0 0 legacy.example legacy-list.example 'full:one.example suffix.example keyword:skip' 'full:list-full.example list.example')" \
  "combined suffix ignores legacy"
assert_csv "xn--80aswg.xn--p1ai" \
  "$(condition_csv domain_suffix domains 0 0 '' '' 'сайт.рф full:пример.испытание keyword:пример regex:^сайт[.]рф$' '')" \
  "combined IDN suffix is punycoded"
assert_csv "xn--e1afmkfd.xn--80akhbyknj4f" \
  "$(condition_csv domain domains 0 0 '' '' 'сайт.рф full:пример.испытание keyword:пример regex:^сайт[.]рф$' '')" \
  "combined IDN full domain is punycoded"
assert_csv "xn--e1afmkfd" \
  "$(condition_csv domain_keyword generic 0 0 '' '' 'сайт.рф full:пример.испытание keyword:пример regex:^сайт[.]рф$' '')" \
  "combined IDN keyword is punycoded"
assert_csv "^xn--80aswg[.]xn--p1ai$" \
  "$(condition_csv domain_regex generic 0 0 '' '' 'сайт.рф full:пример.испытание keyword:пример regex:^сайт[.]рф$' '')" \
  "combined IDN regex is punycoded"

printf 'Condition CSV owner checks passed\n'
