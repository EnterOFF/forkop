import { describe, expect, it } from 'vitest';

import {
  CA,
  CLIENT_CERT,
  CLIENT_KEY,
  ENCRYPTED_KEY,
} from '../../../../../helpers/tests/openvpnFixtures';
import {
  openConnectEndpoint,
  openConnectInitialSettings,
  validateOpenConnectSettings,
} from '../openconnect';

const lines = (value: string) => value.split('\n');
const PIN = 'pin-sha256:svnty/laZqBAdkrdaiQxUb+x8kHPG7QJjSPRjA20WhU=';

describe('OpenConnect tunnel form', () => {
  it('shows an endpoint and stores it back unchanged', () => {
    const endpoint = {
      type: 'openconnect',
      server: 'vpn.example.com:8443/staff',
      flavor: 'gp',
      external_auth_disabled: true,
      username: 'alice',
      password: ' secret ',
      auth_group: 'Staff',
      token: { mode: 'totp', secret: 'JBSWY3DPEHPK3PXP' },
      no_udp: true,
      reported_os: 'win',
      user_agent: 'PAN GlobalProtect',
      compression_disabled: true,
      mtu: 1300,
      dpd_interval: '30s',
      cookie: 'webvpn=abc',
      form_entries: [{ form_id: 'main', name: 'answer', value: '42' }],
      tls: {
        certificate_authority: lines(CA),
        peer_fingerprint: [PIN],
        client_certificate: lines(CLIENT_CERT),
        client_key: lines(ENCRYPTED_KEY),
        client_key_password: 'pass',
        server_name: 'vpn.example.com',
      },
    };
    const settings = openConnectInitialSettings(endpoint);
    expect(settings).toMatchObject({
      openconnect_server: 'vpn.example.com:8443/staff',
      openconnect_flavor: 'gp',
      openconnect_certificate_enabled: '1',
      openconnect_token_mode: 'totp',
      openconnect_advanced: '1',
      openconnect_browser: '0',
      openconnect_dpd: '30',
      openconnect_compression: 'off',
      openconnect_form_entries: ['main:answer=42'],
    });
    expect(openConnectEndpoint(settings)).toEqual(endpoint);
    expect(validateOpenConnectSettings(settings)).toBe(true);
  });

  it('keeps what a stored endpoint holds beyond the form', () => {
    const endpoint = {
      type: 'openconnect',
      server: 'vpn.example.com',
      flavor: 'anyconnect',
      external_auth_disabled: true,
      username: 'alice',
      mobile: {
        platform_version: '17',
        device_type: 'iPhone',
        device_unique_id: 'x',
      },
      token: { mode: 'hotp', secret: 'JBSWY3DPEHPK3PXP', counter: 5 },
      form_entries: [{ submission_key: 'answer', value: '1' }],
      tls: { mca_certificate: lines(CLIENT_CERT), mca_key: lines(CLIENT_KEY) },
      reconnect_timeout: '10m',
    };
    const settings = openConnectInitialSettings(endpoint);
    expect(settings.openconnect_token_mode).toBe('');
    expect(settings.openconnect_advanced).toBe('0');
    expect(openConnectEndpoint(settings)).toEqual(endpoint);
  });

  it('offers a browser sign-in only to an endpoint that asks for it', () => {
    const settings = openConnectInitialSettings({
      type: 'openconnect',
      server: 'vpn.example.com',
      username: 'alice',
    });
    expect(settings.openconnect_browser).toBe('1');
    expect(settings.openconnect_advanced).toBe('1');
    expect(
      openConnectEndpoint(settings).external_auth_disabled,
    ).toBeUndefined();
    settings.openconnect_advanced = '0';
    expect(openConnectEndpoint(settings).external_auth_disabled).toBe(true);
  });

  it('drops the advanced fields with their switch and the certificate with its own', () => {
    const settings = openConnectInitialSettings({
      type: 'openconnect',
      server: 'vpn.example.com',
      username: 'alice',
      cookie: 'webvpn=abc',
      external_auth_disabled: true,
      tls: {
        client_certificate: lines(CLIENT_CERT),
        client_key: lines(CLIENT_KEY),
      },
    });
    settings.openconnect_advanced = '0';
    settings.openconnect_certificate_enabled = '0';
    expect(openConnectEndpoint(settings)).toEqual({
      type: 'openconnect',
      server: 'vpn.example.com',
      flavor: 'anyconnect',
      external_auth_disabled: true,
      username: 'alice',
    });
  });

  it('stores a TOTP secret the way the core reads it', () => {
    const endpoint = openConnectEndpoint({
      openconnect_server: 'https://vpn.example.com:443/',
      openconnect_username: 'alice',
      openconnect_token_mode: 'totp',
      openconnect_token_secret: ' jbsw y3dp ehpk 3pxp ',
      openconnect_fingerprints: [
        'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01',
      ],
    });
    expect(endpoint).toEqual({
      type: 'openconnect',
      server: 'vpn.example.com',
      flavor: 'anyconnect',
      external_auth_disabled: true,
      username: 'alice',
      token: { mode: 'totp', secret: 'JBSWY3DPEHPK3PXP' },
      tls: { peer_fingerprint: ['abcdef0123456789abcdef0123456789abcdef01'] },
    });
  });

  it('refuses a tunnel the router could not sign in with', () => {
    const valid = {
      openconnect_server: 'vpn.example.com',
      openconnect_username: 'alice',
    };
    expect(validateOpenConnectSettings(valid)).toBe(true);
    expect(
      validateOpenConnectSettings({ ...valid, openconnect_server: '' }),
    ).toBe('Fix the settings');
    expect(
      validateOpenConnectSettings({ ...valid, openconnect_username: '' }),
    ).toBe('Add a username, a client certificate or a session cookie');
    expect(
      validateOpenConnectSettings({
        openconnect_server: 'vpn.example.com',
        openconnect_certificate_enabled: '1',
        openconnect_cert: CLIENT_CERT,
        openconnect_key: CLIENT_KEY,
      }),
    ).toBe(true);
    expect(
      validateOpenConnectSettings({
        ...valid,
        openconnect_certificate_enabled: '1',
        openconnect_cert: CLIENT_CERT,
      }),
    ).toBe('Fix the settings');
    expect(
      validateOpenConnectSettings({
        ...valid,
        openconnect_certificate_enabled: '1',
        openconnect_cert: CLIENT_CERT,
        openconnect_key: ENCRYPTED_KEY,
      }),
    ).toBe('Fix the settings');
    expect(
      validateOpenConnectSettings({
        ...valid,
        openconnect_token_mode: 'totp',
        openconnect_token_secret: 'not base32!',
      }),
    ).toBe('Fix the settings');
    expect(
      validateOpenConnectSettings({
        ...valid,
        openconnect_fingerprints: ['md5:abcd'],
      }),
    ).toBe('Fix the settings');
  });
});
