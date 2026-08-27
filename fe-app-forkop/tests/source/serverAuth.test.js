// The Mixed inbound is the only server protocol that may run without accounts,
// and everything that follows from that switch has to agree: the client dialog
// hides the password, the credential checks skip it, and the share links carry
// no login. The switch is named in the protocol table so every layer reads one
// truth.
import { describe, expect, it } from 'vitest';

import { tabFunction, tabSource } from '../lib/tabSource.js';

describe('the protocol table', () => {
  it('gives the Mixed inbound an optional authentication switch', async () => {
    const source = await tabSource('servers');
    const mixed = source.slice(source.indexOf("id: 'mixed'"));
    expect(mixed.slice(0, mixed.indexOf('credentials:'))).toContain(
      "optionalAuth: 'mixed_auth_enabled'",
    );
  });

  it('gives it to no other protocol', async () => {
    const source = await tabSource('servers');
    expect(source.match(/optionalAuth:/g)).toHaveLength(1);
  });
});

describe('the authentication switch', () => {
  it('is on by default and limited to Mixed servers', async () => {
    const block = await tabFunction('servers', 'addMixedOptions');
    expect(block).toContain("_('Authentication')");
    expect(block).toContain("o.default = '1'");
    expect(block).toContain("o.depends('protocol', 'mixed')");
  });

  // With authentication off the inbound takes no users at all.
  it('hides the password in the client dialog', async () => {
    const block = await tabFunction('servers', 'visibleClientFields');
    expect(block).toContain("if (field === 'password') {");
    expect(block).toContain('return isAuthenticationEnabled(sectionId);');
  });

  it('makes the credential checks skip the password', async () => {
    expect(await tabSource('servers')).toContain(
      "if (field === 'password' && !isAuthenticationEnabled(sectionId))",
    );
  });

  it('leaves the credentials out of the share links', async () => {
    expect(await tabFunction('servers', 'buildMixedLinks')).toContain(
      'isAuthenticationEnabled(sectionId)',
    );
  });
});

// One listener answers both schemes, so both links are offered.
describe('a Mixed server', () => {
  it.each(["shareUrl('socks5'", "shareUrl('http'"])(
    'publishes a %s) link',
    async (scheme) => {
      expect(await tabFunction('servers', 'buildMixedLinks')).toContain(scheme);
    },
  );
});

// A NaiveProxy client verifies the certificate the way a browser does, so the
// self-signed one Forkop issues is refused and the button that issues it is not
// offered there. The two path fields stay, for a certificate of your own.
describe('the certificate button', () => {
  it('is withheld from NaiveProxy and from nothing else', async () => {
    expect(await tabFunction('servers', 'offersCertificateButton')).toContain(
      "protocol !== 'naive'",
    );
  });

  it('follows that rule', async () => {
    expect(await tabFunction('servers', 'addCertificateButton')).toContain(
      'offersCertificateButton',
    );
  });

  // LuCI renders every option once and a later change only shows and hides them,
  // so a server that started as Mixed kept a button an existing NaiveProxy
  // server never had.
  it('follows a protocol change too', async () => {
    expect(await tabFunction('servers', 'addIdentityOptions')).toContain(
      'syncCertificateButton(sectionId, value)',
    );
  });

  it('has its visibility set when the row is built', async () => {
    expect(await tabFunction('servers', 'addIssueButton')).toContain(
      'showIssueButton(row, offered(getProtocol(sectionId)))',
    );
  });
});

// Both path fields read the same whatever the listener speaks, so nothing
// rewrites a description per protocol any more.
it('the certificate fields carry no per-protocol description', async () => {
  expect(await tabSource('servers')).not.toContain('describePerProtocol');
});

// XTLS Vision needs the raw TLS stream the listener owns, so the flow disappears
// wherever a transport wraps it or a multiplexed client drops it.
it('the client dialog hides the flow where Vision cannot be carried', async () => {
  const block = await tabFunction('servers', 'visibleClientFields');
  expect(block).toContain("if (field === 'flow') {");
  expect(block).toContain('return supportsVisionFlow(sectionId);');
});
