// The greyed-out examples in the Sections and Settings tabs are the only
// documentation those fields have left, so each one is held against the very
// validator the field runs on real input. A validator that grows stricter than
// its own example fails here instead of in front of a user.

import { describe, expect, it } from 'vitest';

import {
  createUciStub,
  loadLuciView,
  resetLuciViewCache,
} from './loadLuciView';
import { analyzeStaticHosts } from '../../validators/validateStaticHosts';
import { validateOutboundJson } from '../../validators/validateOutboundJson';

function loadSection() {
  resetLuciViewCache();
  return loadLuciView('section', createUciStub(), [
    'DOMAIN_CONDITION_PLACEHOLDER',
    'IP_CONDITION_PLACEHOLDER',
    'JSON_ENDPOINT_PLACEHOLDER',
    'JSON_ENDPOINT_TYPES',
    'JSON_OUTBOUND_PLACEHOLDER',
    'OVERRIDE_PATCH_PLACEHOLDER',
    'analyzeDomainSuffixText',
    'analyzeIpCidrText',
    'reservedOverridePatchPath',
  ]);
}

function loadServer() {
  resetLuciViewCache();
  return loadLuciView('server', createUciStub(), [
    'JSON_INBOUND_PLACEHOLDER',
    'validateInboundJson',
  ]);
}

function loadSettings() {
  resetLuciViewCache();
  return loadLuciView('settings', createUciStub(), [
    'STATIC_HOSTS_PLACEHOLDER',
  ]);
}

describe('condition placeholders', () => {
  const section = loadSection();

  it('offers a domain example the domain analyzer accepts', () => {
    const analysis = section.analyzeDomainSuffixText(
      section.DOMAIN_CONDITION_PLACEHOLDER,
    );

    expect(analysis.message).toBe('');
    expect(analysis.annotations).toEqual([]);
    expect(analysis.valid).toBe(true);
  });

  it('shows every domain prefix the field understands', () => {
    const prefixes = section.DOMAIN_CONDITION_PLACEHOLDER.split('\n')
      .map((line) => line.split(':')[0])
      .filter((prefix) => ['full', 'keyword', 'regex'].includes(prefix));

    expect(prefixes.sort()).toEqual(['full', 'keyword', 'regex']);
  });

  it('offers an IP example the IP analyzer accepts', () => {
    const analysis = section.analyzeIpCidrText(
      section.IP_CONDITION_PLACEHOLDER,
    );

    expect(analysis.message).toBe('');
    expect(analysis.annotations).toEqual([]);
    expect(analysis.valid).toBe(true);
  });

  it('shows a bare address, an IPv4 subnet and an IPv6 subnet', () => {
    expect(section.IP_CONDITION_PLACEHOLDER.split('\n')).toEqual([
      expect.not.stringContaining('/'),
      expect.stringMatching(/^\d+\.\d+\.\d+\.\d+\/\d+$/),
      expect.stringMatching(/^[0-9a-f:]+\/\d+$/),
    ]);
  });
});

describe('JSON placeholders', () => {
  const section = loadSection();

  it('offers a JSON outbound the outbound validator accepts', () => {
    expect(validateOutboundJson(section.JSON_OUTBOUND_PLACEHOLDER)).toEqual({
      valid: true,
      message: 'Valid',
    });
  });

  it('offers a JSON endpoint of a type the tunnel dialog allows', () => {
    const endpoint = JSON.parse(section.JSON_ENDPOINT_PLACEHOLDER);

    expect(section.JSON_ENDPOINT_TYPES.has(endpoint.type)).toBe(true);
    expect(endpoint.tag.trim()).not.toBe('');
    // The generator reads the endpoint tag as the name the tunnel is listed
    // under, so an example without one would teach the wrong shape.
    expect(Buffer.from(endpoint.private_key, 'base64')).toHaveLength(32);
  });

  it('offers a JSON inbound the inbound validator accepts', () => {
    const server = loadServer();

    expect(
      server.validateInboundJson('srv', server.JSON_INBOUND_PLACEHOLDER),
    ).toBe(true);
  });

  it('offers a server-parameters patch the field does not refuse', () => {
    const patch = JSON.parse(section.OVERRIDE_PATCH_PLACEHOLDER);

    // Every path with its own control above the field is rejected on save, so
    // the example may not use one.
    expect(section.reservedOverridePatchPath(patch)).toBeUndefined();
  });
});

describe('static DNS records placeholder', () => {
  it('offers records the hosts analyzer accepts', () => {
    const settings = loadSettings();
    const analysis = analyzeStaticHosts(settings.STATIC_HOSTS_PLACEHOLDER);

    expect(analysis.message).toBe('Valid');
    expect(analysis.valid).toBe(true);
  });
});
