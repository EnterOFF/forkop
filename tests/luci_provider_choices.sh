#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECTION_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/section.js"

node - "$SECTION_JS" <<'NODE'
const assert = require('assert');
const fsNode = require('fs');

const source = fsNode.readFileSync(process.argv[2], 'utf8');
const helpers = source.match(
  /function nativeProviderOutboundNames\([\s\S]*?\nfunction readOutboundChoiceState\(/,
);
assert(helpers, 'native provider choice helpers not found');

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

const providerTag = 'main-subscription-1-provider';
const payload = {
  providers: {
    [providerTag]: {
      proxies: [
        { name: `${providerTag}/Main US`, type: 'VLESS' },
        { name: `${providerTag}/Main DE`, type: 'AnyTLS' },
        { name: `${providerTag}/Main Auto`, type: 'URLTest' },
      ],
    },
    'other-subscription-provider': {
      proxies: [{ name: 'other-subscription-provider/Other JP', type: 'VLESS' }],
    },
  },
};
let response = Promise.resolve({ stdout: JSON.stringify(payload) });
const calls = [];
const fs = {
  exec(path, args) {
    calls.push([path, args]);
    return response;
  },
};

eval(helpers[0].slice(0, -'\nfunction readOutboundChoiceState('.length));

assert.deepStrictEqual(nativeProviderOutboundNames([providerTag], payload), [
  'Main US',
  'Main DE',
]);
assert.strictEqual(
  subscriptionSourceOutboundName('Main US', '1', 'Main'),
  'US',
  'subscription filter must use the pre-tag_prefix node name',
);
assert.strictEqual(
  subscriptionSourceOutboundName('Main US', '0', 'Main'),
  'Main US',
  'disabled prefixing must leave the node name unchanged',
);
assert.strictEqual(
  subscriptionSourceOutboundName('Mainland US', '1', 'Main'),
  'Mainland US',
  'partial prefix matches must not change the node name',
);

(async () => {
  assert.deepStrictEqual(await loadNativeProviderOutboundNames([providerTag]), [
    'Main US',
    'Main DE',
  ]);
  assert.deepStrictEqual(calls, [
    ['/usr/bin/forkop', ['clash_api', 'get_proxy_providers']],
  ]);

  response = Promise.reject(new Error('sing-box is unavailable'));
  assert.deepStrictEqual(
    await loadNativeProviderOutboundNames([providerTag]),
    [],
    'native provider choice lookup must fail open',
  );

  const callsBeforeEmptyLookup = calls.length;
  assert.deepStrictEqual(await loadNativeProviderOutboundNames([]), []);
  assert.strictEqual(calls.length, callsBeforeEmptyLookup);

  assert.match(
    source,
    /loadNativeProviderOutboundNames\(state\.providerTags\)/,
    'provider names are not mixed into loadOutboundNameChoices',
  );
  assert.match(
    source,
    /normalizeOutboundChoice:[\s\S]*subscriptionSourceOutboundName\(/,
    'subscription choices do not account for native tag_prefix ordering',
  );

  console.log('LuCI native provider choice checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
